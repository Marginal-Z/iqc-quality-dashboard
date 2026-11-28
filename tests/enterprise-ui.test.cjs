const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
test('ordinary workspace polish excludes both wallboards and changes only paint properties',()=>{
  const css=readFileSync(join(__dirname,'../assets/enterprise-ui.css'),'utf8').replace(/\/\*[\s\S]*?\*\//g,'');
  assert.ok(!/gradient\s*\(/i.test(css));
  let count=0;
  for(const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)){
    count++;assert.match(rule[1].trim(),/^body:not\(\.wallboard-mode\):not\(\.supplier-wallboard-mode\)/);
    for(const declaration of rule[2].split(';').filter(value=>value.trim())){
      const property=declaration.split(':')[0].trim();
      assert.ok(property.startsWith('--')||/^(?:background(?:-color)?|color|border(?:-right|-bottom)?-color|box-shadow)$/.test(property),'Unexpected geometry or typography property: '+property);
    }
  }
  assert.ok(count>15);
});
