import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../src/game.js';
import {TILE,SIM_DT} from '../src/config.js';
test('a defender settles beside a formation slot covered by a newly built structure',()=>{
 const size=48,map={size,seed:19,sites:[],nestSpots:[],nodeSpots:[],tiles:new Uint8Array(size*size).fill(TILE.GRASS),idx:(x,z)=>z*size+x,inBounds:(x,z)=>x>=0&&z>=0&&x<size&&z<size,isBuildable:(x,z)=>x>=0&&z>=0&&x<size&&z<size,isWalkable:(x,z)=>x>=0&&z>=0&&x<size&&z<size};
 const g=new Game(map,'normal','lina',null,2),u=g._spawnUnit('soldier',21.77723130675064,19.96865315336096);
 g.stance='defend';g.zombies=[];g.nests=[];u.holdX=20.48016773627685;u.holdZ=20.80968699735841;
 // Reduced obstacle fixture from the Rotmire/Lina/builder reproduction.
 const rows=["....####################...",".....####################..","##...##..################..","##...##.......############.","................###########","##...............##########","##................#########","...................########","#..##.....##........#######","#..##.##..##........#######","......##.....##......######","...##....##..##......######","...##....##...........#####","............##......#######","..##........##.##...#######","..##..####.....##....######","......####.............####","..##..####.....##.......###","..##..####.....##.......###","#.......................###","#.......................###","........................###","........................###","........................###",".......................####",".......................####","..........##...........####"];
 rows.forEach((row,z)=>[...row].forEach((c,x)=>{if(c==='#')g.occ[(z+7)*size+x+8]=999;}));
 g._occStamp++;
 const start=[u.x,u.z];let travelled=0;
 for(let i=0;i<180;i++){const old=[u.x,u.z];g._updateUnits(SIM_DT);travelled+=Math.hypot(u.x-old[0],u.z-old[1]);}
 assert.ok(travelled<1,`defender kept walking ${travelled.toFixed(2)} tiles beside an occupied slot`);
 assert.ok(Math.hypot(u.x-start[0],u.z-start[1])<1);assert.equal(u.moving,false);
});
