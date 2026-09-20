import { useId } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useFlightStore } from '../flightStore';
import { toFeetAgl, toKnots } from './telemetry';
import './hud.css';

const DESIGN: 'projected' | 'glass' | 'minimal' = 'projected';
const PITCH_MARKS = Array.from({ length: 17 }, (_, i) => (i - 8) * 5);

function Attitude({ pitch, bank, round, filled }: { pitch: number; bank: number; round: boolean; filled: boolean }) {
  const id = useId();
  return <svg className="flight-attitude" viewBox="0 0 300 230" role="img" aria-label={`Pitch ${pitch.toFixed(0)} degrees, bank ${bank.toFixed(0)} degrees`}>
    <defs><clipPath id={id}>{round ? <circle cx="150" cy="115" r="100" /> : <rect x="0" y="0" width="300" height="230" rx="4" />}</clipPath></defs>
    <g clipPath={`url(#${id})`}>
      <g transform={`translate(150 115) rotate(${-bank}) translate(0 ${pitch * 4})`}>
        {filled && <><rect x="-450" y="-600" width="900" height="600" fill="#1766a6" /><rect x="-450" y="0" width="900" height="600" fill="#795438" /></>}
        {PITCH_MARKS.map(deg => <g key={deg} transform={`translate(0 ${-deg * 4})`} className="pitch-mark">
          <path d={deg === 0 ? 'M-300 0H-18 M18 0H300' : `M-${deg % 10 ? 35 : 65} 0H-17 M17 0H${deg % 10 ? 35 : 65}`} strokeDasharray={deg < 0 ? '5 4' : undefined} />
          {deg !== 0 && deg % 10 === 0 && <><text x="-78" y="4">{Math.abs(deg)}</text><text x="78" y="4">{Math.abs(deg)}</text></>}
        </g>)}
      </g>
    </g>
    {round && <circle cx="150" cy="115" r="103" className="gauge-rim" />}
    <g className="bank-scale">{[-60,-30,0,30,60].map(deg => <path key={deg} transform={`rotate(${deg} 150 115)`} d="M150 18V26" />)}</g>
    <path className="aircraft-reference" d="M102 115h28l8 7 12-7 12 7 8-7h28" />
    <path className="bank-pointer" d="M146 31l4-7 4 7" transform={`rotate(${-bank} 150 115)`} />
  </svg>;
}

function Tape({ value, label, step }: { value: number; label: string; step: number }) {
  const id = useId();
  const rounded = Math.round(value);
  return <svg viewBox="0 0 86 230" className="flight-tape" role="img" aria-label={`${label} ${rounded}`}>
    <defs><clipPath id={id}><rect x="0" y="30" width="86" height="175" /></clipPath></defs>
    <text x="43" y="16" className="tape-label">{label}</text>
    <rect className="tape-background" x="6" y="30" width="74" height="175" />
    <g clipPath={`url(#${id})`}>{Array.from({length:9},(_,i)=>Math.floor(value/step)*step+(i-4)*step).filter(n=>n>=0).map(n=><g key={n} transform={`translate(0 ${115-(n-value)/step*32})`}><path d="M66 0H76" /><text x="39" y="4">{n}</text></g>)}</g>
    <path className="tape-window" d="M3 98H65L81 115 65 132H3Z" />
    <text x="35" y="121" className="tape-value">{rounded}</text>
  </svg>;
}

export function FlightHud() {
  const f = useFlightStore(useShallow(s => ({ pitch:s.pitch,bank:s.bank,heading:s.heading,airspeed:s.airspeed,throttle:s.throttle,y:s.position.y,verticalSpeed:s.verticalSpeed,crashed:s.crashed,crashReason:s.crashReason,grounded:s.grounded,angleOfAttack:s.angleOfAttack })));
  const speed = toKnots(f.airspeed);
  const altitude = toFeetAgl(f.y);
  const throttle = Math.round(Math.max(0,Math.min(1,f.throttle))*100);
  const heading = String(Math.round(f.heading)%360).padStart(3,'0');
  const stall = !f.grounded && (speed <= 105 || f.angleOfAttack >= 0.42);
  const warning = f.crashed ? 'CRASHED' : stall ? 'STALL' : speed > 350 ? 'OVERSPEED' : '';
  const mode: string = DESIGN;
  return <div className={`flight-hud flight-hud--${mode}`} aria-label={`${mode} aircraft instruments`}>
    <div className="hud-instruments">
      <div className="hud-heading"><span>HDG</span> {heading}° <span className="hud-mode">{mode === 'projected' ? 'ATT' : mode === 'glass' ? 'PFD' : 'FLIGHT'}</span></div>
      {mode === 'minimal' ? <div className="minimal-row">
        <div className="hud-number"><span>AIRSPEED</span><strong>{Math.round(speed)}</strong><small>KT</small></div>
        <Attitude pitch={f.pitch} bank={f.bank} round filled />
        <div className="hud-number"><span>HEIGHT</span><strong>{Math.round(altitude)}</strong><small>FT AGL</small></div>
      </div> : <div className="instrument-row">
        <Tape value={speed} label="SPD KT" step={20} />
        <Attitude pitch={f.pitch} bank={f.bank} round={mode === 'projected'} filled={mode === 'glass' || mode === 'projected'} />
        <Tape value={altitude} label="FT AGL" step={100} />
      </div>}
      <div className="hud-bottom"><div className="throttle"><div><span>THR</span><strong>{throttle}%</strong></div><div className="throttle-track" role="meter" aria-label="Throttle position" aria-valuemin={0} aria-valuemax={100} aria-valuenow={throttle}><i style={{width:`${throttle}%`}} /></div></div><div className="vertical-speed"><span>V/S</span> {f.verticalSpeed>=0?'+':''}{Math.round(f.verticalSpeed*3*196.85)} <span>FPM</span></div></div>
      <div className="hud-warning" role="status" aria-live="polite">{warning || (f.grounded ? 'ON GROUND' : '')}</div>
      {f.crashed && <div className="hud-restart"><span>{f.crashReason}</span><button onClick={()=>useFlightStore.getState().resetFlight()}>Fly again</button></div>}
    </div>
    <div className="hud-controls">W / S · THROTTLE <b>·</b> A / D · BANK <b>·</b> SPACE / SHIFT · PITCH</div>
  </div>;
}
