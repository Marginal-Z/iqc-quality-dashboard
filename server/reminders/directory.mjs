import { randomUUID } from 'node:crypto';
import { readSettings, credentialKey, ReminderError } from './store.mjs';
import { createFeishuClient } from './feishu.mjs';

export const directoryName = value => String(value || '').normalize('NFKC').trim().toLocaleLowerCase();
const validId = id => /^ou_[A-Za-z0-9_-]{4,124}$/.test(id);
const validDepartment = id => /^[A-Za-z0-9][A-Za-z0-9_@.-]{0,63}$/.test(id);
const invalid = () => new ReminderError('DIRECTORY_INCOMPLETE', 503);
const seconds = clock => Math.floor(clock() / 1000);

export async function directoryStatus(env) {
  return env.REMINDER_DB.prepare('SELECT * FROM feishu_directory_state WHERE id=1').first();
}
export async function requestDirectorySync(env) {
  await env.REMINDER_DB.prepare('UPDATE feishu_directory_state SET next_refresh_at=0,last_error=\'\' WHERE id=1').run();
  return { requested: true };
}
export async function searchDirectory(env, query = '') {
  if (typeof query !== 'string' || query.length > 80 || /[\x00-\x1f\x7f]/.test(query)) throw new ReminderError('INVALID_EMPLOYEE_SEARCH');
  const bot = await readSettings(env), state = await directoryStatus(env);
  if (!bot.appSecret || bot.verified_key !== credentialKey(bot.app_id, bot.appSecret)) throw new ReminderError('CONNECTION_NOT_VERIFIED', 409);
  const current = state.app_id === bot.app_id && state.credential_key === credentialKey(bot.app_id,bot.appSecret), generation = current ? state.active_generation || state.generation : '';
  // instr handles long Thai/Chinese names and treats %, _ and backslashes literally.
  // D1 limits LIKE patterns to 50 UTF-8 bytes, shorter than a typical full name.
  const pattern = directoryName(query);
  const people = generation ? (await env.REMINDER_DB.prepare(`SELECT open_id AS openId,name,english_name AS englishName FROM feishu_directory_members
    WHERE generation=? AND resolved=1 AND instr(search_name,?)>0 ORDER BY name,open_id LIMIT 31`).bind(generation, pattern).all()).results : [];
  const progress = generation ? await env.REMINDER_DB.prepare('SELECT COUNT(*) total,SUM(resolved<>0) resolved FROM feishu_directory_members WHERE generation=?').bind(state.generation || generation).first() : { total:0,resolved:0 };
  return { people: people.slice(0,30), hasMore: people.length > 30, total: progress.total, resolved: progress.resolved || 0,
    syncing: !current || state.stage !== 'idle' || !state.active_generation || state.next_refresh_at <= Math.floor(Date.now()/1000), complete: Boolean(current && state.active_generation),
    fetchedAt: current ? state.last_success_at : 0, lastError: current ? state.last_error : '', scope: 'company_directory' };
}
export async function verifyEmployee(env, openId, { fetchImpl = fetch, clock = () => Date.now() } = {}) {
  if (!validId(openId)) throw new ReminderError('INVALID_RECIPIENTS');
  const bot = await readSettings(env);
  if (!bot.appSecret || bot.verified_key !== credentialKey(bot.app_id,bot.appSecret)) throw new ReminderError('CONNECTION_NOT_VERIFIED',409);
  const result = await createFeishuClient(bot.app_id,bot.appSecret,{fetchImpl,now:clock}).profiles([openId]);
  const person = result?.users?.find(row => row.user_id === openId);
  if (!person || typeof person.name !== 'string' || !person.name.trim() || person.name.length > 160) throw new ReminderError('EMPLOYEE_NOT_IN_SCOPE',409);
  return { openId, name: person.name.trim() };
}

// This runs through a separate, private scheduled service invocation. Directory
// indexing cannot consume the inspection reminder's QMS or D1 request budget.
export async function runDirectoryCycle(env, { fetchImpl = fetch, clock = () => Date.now(), limit = 8, pause = () => new Promise(resolve=>setTimeout(resolve,250)) } = {}) {
  const db = env.REMINDER_DB, owner = randomUUID(), time = seconds(clock);
  const lease = await db.prepare('UPDATE feishu_directory_state SET lease_owner=?,lease_until=? WHERE id=1 AND lease_until<=? RETURNING id').bind(owner,time+180,time).first();
  if (!lease) return { busy:true };
  let state;
  try {
    const bot = await readSettings(env);
    if (!bot.appSecret || bot.verified_key !== credentialKey(bot.app_id,bot.appSecret)) throw new ReminderError('CONNECTION_NOT_VERIFIED',503);
    const key = credentialKey(bot.app_id,bot.appSecret);
    state = await directoryStatus(env);
    if (state.stage === 'idle' && state.next_refresh_at > time && state.app_id === bot.app_id && state.credential_key === key) return { idle:true };
    if (state.stage === 'idle' || state.app_id !== bot.app_id || state.credential_key !== key) {
      state = { ...state, app_id:bot.app_id,credential_key:key,generation:randomUUID(),stage:'scope',scope_cursor:'' };
      await db.prepare(`UPDATE feishu_directory_state SET app_id=?,credential_key=?,generation=?,stage='scope',scope_cursor='',last_error='' WHERE id=1 AND lease_owner=?`)
        .bind(bot.app_id,key,state.generation,owner).run();
    }
    const client = createFeishuClient(bot.app_id,bot.appSecret,{fetchImpl,now:clock});
    const guard = 'EXISTS(SELECT 1 FROM feishu_directory_state WHERE lease_owner=? AND generation=? AND credential_key=?)';
    const values = [owner,state.generation,key];
    const memberInsert = ids => db.prepare(`INSERT OR IGNORE INTO feishu_directory_members(generation,open_id)
      SELECT ?,value FROM json_each(?) WHERE ${guard}`).bind(state.generation,JSON.stringify(ids),...values);
    const departmentInsert = (ids,root) => db.prepare(`INSERT INTO feishu_directory_departments(generation,department_id,is_root)
      SELECT ?,value,? FROM json_each(?) WHERE ${guard}
      ON CONFLICT(generation,department_id) DO UPDATE SET is_root=MAX(is_root,excluded.is_root)`).bind(state.generation,Number(root),JSON.stringify(ids),...values);
    let requests = 0;
    const checkPage = (data,cursor) => {
      if (!data || typeof data.has_more !== 'boolean' || data.has_more && (typeof data.page_token !== 'string' || !data.page_token || data.page_token===cursor || data.page_token.length>4096)) throw invalid();
      return data.has_more ? data.page_token : '';
    };
    while (requests < Math.max(1,Math.min(8,limit))) {
      if (state.stage === 'scope') {
        const data = await client.contacts('scopes',{user_id_type:'open_id',department_id_type:'open_department_id',page_size:'100',...(state.scope_cursor?{page_token:state.scope_cursor}:{})});requests++;
        const next = checkPage(data,state.scope_cursor), users=data.user_ids||[],departments=data.department_ids||[];
        if (!Array.isArray(users)||!Array.isArray(departments)||users.some(id=>!validId(id))||departments.some(id=>!validDepartment(id)))throw invalid();
        if (data.group_ids?.length)throw new ReminderError('DIRECTORY_GROUP_SCOPE',422);
        await db.batch([memberInsert(users),departmentInsert(departments,true),db.prepare(`UPDATE feishu_directory_state SET scope_cursor=?,stage=?,last_checked_at=?,last_error='' WHERE id=1 AND ${guard}`).bind(next,next?'scope':'departments',time,...values)]);
        state.scope_cursor=next; if(!next)state.stage='departments';
      } else if (state.stage === 'departments') {
        const job = await db.prepare('SELECT * FROM feishu_directory_departments WHERE generation=? AND is_root=1 AND children_done=0 ORDER BY department_id LIMIT 1').bind(state.generation).first();
        if (!job) { state.stage='users';await db.prepare(`UPDATE feishu_directory_state SET stage='users' WHERE id=1 AND ${guard}`).bind(...values).run();continue; }
        const data = await client.contacts(`departments/${job.department_id}/children`,{department_id_type:'open_department_id',fetch_child:'true',page_size:'50',...(job.children_cursor?{page_token:job.children_cursor}:{})});requests++;
        const next=checkPage(data,job.children_cursor);if(!Array.isArray(data.items)||data.items.some(row=>!validDepartment(row.open_department_id)))throw invalid();
        await db.batch([departmentInsert(data.items.map(row=>row.open_department_id),false),db.prepare(`UPDATE feishu_directory_departments SET children_cursor=?,children_done=? WHERE generation=? AND department_id=? AND ${guard}`).bind(next,Number(!next),state.generation,job.department_id,...values)]);
      } else if (state.stage === 'users') {
        const job = await db.prepare('SELECT * FROM feishu_directory_departments WHERE generation=? AND users_done=0 ORDER BY department_id LIMIT 1').bind(state.generation).first();
        if (!job) { state.stage='names';await db.prepare(`UPDATE feishu_directory_state SET stage='names' WHERE id=1 AND ${guard}`).bind(...values).run();continue; }
        const data=await client.contacts('users/find_by_department',{user_id_type:'open_id',department_id_type:'open_department_id',department_id:job.department_id,page_size:'50',...(job.users_cursor?{page_token:job.users_cursor}:{})});requests++;
        const next=checkPage(data,job.users_cursor);if(!Array.isArray(data.items)||data.items.some(row=>!validId(row.open_id)))throw invalid();
        await db.batch([memberInsert(data.items.map(row=>row.open_id)),db.prepare(`UPDATE feishu_directory_departments SET users_cursor=?,users_done=? WHERE generation=? AND department_id=? AND ${guard}`).bind(next,Number(!next),state.generation,job.department_id,...values)]);
      } else if (state.stage === 'names') {
        const batch=(await db.prepare('SELECT open_id FROM feishu_directory_members WHERE generation=? AND resolved=0 ORDER BY open_id LIMIT 10').bind(state.generation).all()).results.map(row=>row.open_id);
        if(!batch.length){
          await db.batch([db.prepare(`UPDATE feishu_directory_state SET active_generation=generation,stage='idle',last_success_at=?,last_checked_at=?,next_refresh_at=?,last_error='' WHERE id=1 AND ${guard}`).bind(time,time,time+86400,...values),
            db.prepare('DELETE FROM feishu_directory_members WHERE generation NOT IN(SELECT generation FROM feishu_directory_state UNION SELECT active_generation FROM feishu_directory_state)'),
            db.prepare('DELETE FROM feishu_directory_departments WHERE generation NOT IN(SELECT generation FROM feishu_directory_state)')]);state.stage='idle';break;
        }
        await pause();const data=await client.profiles(batch);requests++;if(!Array.isArray(data?.users))throw invalid();
        const seen=new Set(),items=[];
        for(const row of data.users){if(!batch.includes(row.user_id)||seen.has(row.user_id)||typeof row.name!=='string'||!row.name.trim()||row.name.length>160)throw invalid();seen.add(row.user_id);const english=typeof row.i18n_name?.en_us==='string'?row.i18n_name.en_us.slice(0,160):'';
          items.push({id:row.user_id,name:row.name.trim(),english,search:directoryName(row.name+' '+english),resolved:1});}
        // A successful response may omit members removed since the previous page.
        for(const id of batch)if(!seen.has(id))items.push({id,name:'',english:'',search:'',resolved:2});
        await db.prepare(`UPDATE feishu_directory_members SET name=json_extract(value,'$.name'),english_name=json_extract(value,'$.english'),search_name=json_extract(value,'$.search'),resolved=json_extract(value,'$.resolved')
          FROM json_each(?) WHERE generation=? AND open_id=json_extract(value,'$.id') AND ${guard}`).bind(JSON.stringify(items),state.generation,...values).run();
      } else throw invalid();
      // Bound corrupted or unexpectedly large upstream scopes without truncation.
      if(requests%8===0){const counts=await db.prepare('SELECT (SELECT COUNT(*) FROM feishu_directory_members WHERE generation=?) members,(SELECT COUNT(*) FROM feishu_directory_departments WHERE generation=?) departments').bind(state.generation,state.generation).first();if(counts.members>20000||counts.departments>2000)throw new ReminderError('DIRECTORY_TOO_LARGE',422);}
    }
    await db.prepare(`UPDATE feishu_directory_state SET last_checked_at=?,last_error='' WHERE id=1 AND ${guard}`).bind(seconds(clock),...values).run();
    return { requests,stage:state.stage };
  } catch(error){const code=error.code||'DIRECTORY_SERVICE_ERROR';await db.prepare('UPDATE feishu_directory_state SET last_checked_at=?,last_error=? WHERE id=1 AND lease_owner=?').bind(seconds(clock),code,owner).run();return {error:code};}
  finally {await db.prepare("UPDATE feishu_directory_state SET lease_owner='',lease_until=0 WHERE id=1 AND lease_owner=?").bind(owner).run();}
}
