// Run in an active local developer battle; callers capture each viewport.
export async function proveBuilderUI() {
 const a=window.__app,g=a?.game;if(!g?.builders)throw Error('Found a siege city first');
 a.paused=true;g.gold=100;g.zombies=[];a.frame();
 const select=document.querySelector('#builder-order');select.value='prosper';select.dispatchEvent(new Event('change'));a.frame();
 if(g.builders.order!=='prosper'||g.builders.paused)throw Error('Builder order did not reach simulation');
 const reserve=document.querySelector('#builder-reserve');reserve.value='30';reserve.dispatchEvent(new Event('change'));a.frame();
 if(g.builders.reserve!==30)throw Error('Reserve did not reach simulation');
 const {updateBuilders}=await import('../src/builders.js');for(let i=0;i<1800;i++)updateBuilders(g,1/60);a.frame();
 if(!a._builderMesh?.visible||g.builders.completed<1||g.gold<30-1e-6)throw Error('Visible crew/work/reserve contract failed');
 document.querySelector('#builder-pause').click();a.frame();if(!g.builders.paused)throw Error('Pause did not reach simulation');
 const bounds=document.querySelector('#builder-controls').getBoundingClientRect();if(bounds.left<0||bounds.right>innerWidth||bounds.bottom>innerHeight)throw Error('Builder panel exceeds viewport');
 a.ui.update(g,1);if(!document.querySelector('#builder-order').disabled)throw Error('Guest can change builder order');a.ui.update(g,0);
 return {completed:g.builders.completed,gold:g.gold,bounds:{x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height}};
}
