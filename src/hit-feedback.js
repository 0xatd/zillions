import * as THREE from 'three';

// Bounded, presentation-only hero hit numbers. Inspired by the useful portion
// of PR #124; no HUD rewrite, hidden indicators, or simulation hit-stop.
export class HitFeedback {
  constructor(scene) { this.scene=scene;this.active=[]; }
  show(event) {
    if (!event.heroKey || !(event.damage>0) || !Number.isFinite(event.damage)) return;
    while(this.active.length>=24)this._remove(this.active[0]);
    const canvas=document.createElement('canvas');canvas.width=256;canvas.height=96;
    const ctx=canvas.getContext('2d');
    ctx.font='bold 52px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.lineWidth=7;ctx.strokeStyle='#111820';ctx.fillStyle=event.crit?'#ffd75e':'#edf3ff';
    const amount=Math.round(event.damage);
    const text=`${amount>9999 ? (amount/1000).toFixed(1)+'k' : Math.max(1,amount)}${event.crit?'!':''}`;
    ctx.strokeText(text,128,48);ctx.fillText(text,128,48);
    const texture=new THREE.CanvasTexture(canvas);
    const material=new THREE.SpriteMaterial({map:texture,transparent:true,depthWrite:false});
    const sprite=new THREE.Sprite(material);
    const scale=event.crit?1.4:1;
    sprite.scale.set(2.4*scale,.9*scale,1);
    sprite.position.set(event.tx,1.8,event.tz);
    this.scene.add(sprite);
    this.active.push({sprite,age:0,x:event.tx,z:event.tz});
  }
  update(dt,visible=()=>true) {
    for(const item of [...this.active]) {
      item.age+=dt;
      if(item.age>=.65 || !visible(item.x,item.z)){this._remove(item);continue;}
      item.sprite.position.y=1.8+item.age*1.7;
      item.sprite.material.opacity=Math.min(1,(.65-item.age)/.25);
    }
  }
  _remove(item) {
    this.scene.remove(item.sprite);
    item.sprite.material.map.dispose();item.sprite.material.dispose();
    this.active.splice(this.active.indexOf(item),1);
  }
  clear() { for(const item of [...this.active])this._remove(item); }
}
