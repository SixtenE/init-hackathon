import assert from 'node:assert/strict';
import { Quaternion, Euler } from 'three';
import { attitudeFromQuaternion, toKnots, toFeetAgl } from '../src/hud/telemetry.ts';
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-8, `${actual} != ${expected}`);
for(const [pitch,bank,heading] of [[0,0,0],[15,0,0],[-15,0,0],[0,30,0],[0,-30,0],[20,35,270],[-20,-35,90],[5,15,359]]){
 const q=new Quaternion().setFromEuler(new Euler(-pitch*Math.PI/180,heading*Math.PI/180,bank*Math.PI/180,'YXZ'));
 const a=attitudeFromQuaternion(q);near(a.pitch,pitch);near(a.bank,bank);near(a.heading,heading);
}
near(toKnots(250*0.514444/3),250);near(toFeetAgl(-180),0);near(toFeetAgl(-179),3/0.3048);near(toFeetAgl(-181),0);near(toKnots(-10),0);
console.log('Passed attitude sign, combined attitude, heading wrap, speed and AGL conversion checks.');
