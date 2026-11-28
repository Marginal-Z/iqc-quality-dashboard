export default {
  fetch() { return new Response('Not found',{status:404}); },
  async scheduled(_controller,env) {
    for(let step=0;step<2;step++){
      const result=await env.DIRECTORY.sync();
      console.log('IQC directory sync',JSON.stringify(result));
      if(result.error)throw new Error(result.error);
      if(result.idle||result.busy||result.stage==='idle')break;
    }
  }
};
