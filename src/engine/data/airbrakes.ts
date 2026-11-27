// Air brake teaching data: the standard air brake checks with their specs, and the faults the
// mystery mode and the instructor panel can put on the truck (as part modifiers).
import type { FaultSpec } from '../faults';

export interface AirTest {
  id: string;
  title: string;
  /** What the truck needs to be doing. */
  setup: string;
  steps: string[];
  spec: string;
}

/** The air brake check (FMCSA / CDL air brake inspection), adapted to a single tractor with dual circuits. */
export const AIR_TESTS: AirTest[] = [
  {
    id: 'buildup',
    title: 'Pressure build-up time',
    setup: 'Engine running at idle, parked, tanks below 85 psi.',
    steps: ['Fan the brakes (or drain air) until both gauges read under 85 psi.', 'Let the engine idle and start the stopwatch when the lower needle passes 85 psi.', 'Stop it when the lower needle reaches 100 psi.'],
    spec: '85 to 100 psi in 45 seconds or less (dual air system). Slower than that points to a worn compressor, a restriction or a leak in the supply side.',
  },
  {
    id: 'governor',
    title: 'Governor cut-out and cut-in',
    setup: 'Engine running at idle.',
    steps: ['Let pressure build until the compressor stops pumping (the air dryer gives a short purge). Note the pressure: that is cut-out.', 'Fan the brakes slowly until the compressor starts pumping again (the needles start climbing). Note the pressure: that is cut-in.'],
    spec: 'Cut-out 120–135 psi (125 is typical). Cut-in no more than about 25 psi below cut-out (about 100–105 psi).',
  },
  {
    id: 'static',
    title: 'Static leak-down (brakes released)',
    setup: 'Tanks full, engine off, key on, parking brake released, foot off the brake.',
    steps: ['Shut the engine off with the tanks at governor cut-out.', 'Push the park knob in to release the spring brakes.', 'Wait for the needles to settle, then time one minute and note how far each needle drops.'],
    spec: 'Loss no more than 2 psi in one minute for a single vehicle (3 psi for a combination).',
  },
  {
    id: 'applied',
    title: 'Applied leak-down (service brakes held)',
    setup: 'Tanks full, engine off, key on, parking brake released.',
    steps: ['Press the brake pedal fully and hold it (the needles drop as the chambers fill: that is normal).', 'Once the needles settle, time one minute and note how far each needle drops.'],
    spec: 'Loss no more than 3 psi in one minute for a single vehicle (4 psi for a combination).',
  },
  {
    id: 'warning',
    title: 'Low-air warning',
    setup: 'Engine off, key on, parking brake released.',
    steps: ['Fan the brakes: press and release the pedal over and over.', 'Note the pressure when the low-air lamp and buzzer come on.'],
    spec: 'The warning must come on at or before 60 psi (in the lower of the two tanks).',
  },
  {
    id: 'popout',
    title: 'Spring brake / park knob pop-out',
    setup: 'Continue from the low-air warning check.',
    steps: ['Keep fanning the brakes.', 'Note the pressure when the yellow park knob pops out and the spring brakes apply.'],
    spec: 'The park control valve must pop out between 20 and 45 psi.',
  },
  {
    id: 'stroke',
    title: 'Pushrod stroke (brake adjustment)',
    setup: 'Engine off, tanks at 90–100 psi, parking brake released, wheels chocked.',
    steps: ['Mark each pushrod at the chamber face with the brakes released.', 'Hold a full application (90–100 psi).', 'Measure from the chamber face to the mark at every wheel.'],
    spec: 'Readjustment limit (standard stroke): Type 20 = 1¾", Type 24 = 1¾", Type 30 = 2". Long-stroke chambers have longer limits. Over the limit means the slack adjuster or the foundation brake needs attention.',
  },
];

export interface AirFault {
  id: string;
  label: string;
  /** What the driver reports. */
  complaint: string;
  faults: FaultSpec[];
  /** The check that catches it, and why. */
  found: string;
}

export const AIR_FAULTS: AirFault[] = [
  { id: 'primaryLeak', label: 'Leaking fitting on the primary (rear circuit) tank', complaint: 'The primary needle drops overnight; the truck sits on its spring brakes in the morning.',
    faults: [{ part: 'mech.airPrimary', kind: 'leak', value: 5 }], found: 'The static leak-down test fails on the primary needle only; the secondary holds because of its check valve. Soapy water finds the fitting.' },
  { id: 'secondaryLeak', label: 'Leaking fitting on the secondary (front circuit) tank', complaint: 'The secondary needle bleeds down when parked.',
    faults: [{ part: 'mech.airSecondary', kind: 'leak', value: 5 }], found: 'The static leak-down test fails on the secondary needle only.' },
  { id: 'supplyDrain', label: 'Supply (wet) tank drain valve leaking', complaint: 'Both needles drop slowly when parked.',
    faults: [{ part: 'mech.airSupply', kind: 'leak', value: 8 }], found: 'Engine off, the supply tank leaks down and pulls both primary and secondary down with it only while it\'s higher than them; the check valves stop the loss there. Listen at the wet tank drain.' },
  { id: 'springChamber', label: 'Right rear spring brake diaphragm leaking', complaint: 'Air hiss at the rear axle when the parking brake is released.',
    faults: [{ part: 'mech.springChamber.rr', kind: 'leak', value: 6 }], found: 'The static leak-down (brakes released) fails, but the leak stops when the park knob is pulled. Air comes from the spring chamber breather hole.' },
  { id: 'appliedLeak', label: 'Rear relay valve leaking on application', complaint: 'Air pressure drops quickly when holding the brakes at a light.',
    faults: [{ part: 'mech.brakeLine.primary', kind: 'leak', value: 12 }], found: 'The static leak-down passes but the applied leak-down fails. A hiss at the rear relay valve only while the pedal is held.' },
  { id: 'wornCompressor', label: 'Worn air compressor (low output)', complaint: 'Air takes forever to build after a stop; the low-air light stays on a long time after start-up.',
    faults: [{ part: 'mech.compressor', kind: 'damaged' }], found: 'No leaks, but the build-up test from 85 to 100 psi takes well over 45 seconds.' },
  { id: 'governorHigh', label: 'Governor cut-out set too high', complaint: 'The air dryer purges at odd times; the gauges read higher than usual.',
    faults: [{ part: 'mech.governor', kind: 'stuck', value: 145 }], found: 'The governor check shows cut-out at about 145 psi, above the 120–135 psi range.' },
  { id: 'governorLow', label: 'Governor cut-out set too low', complaint: 'Air pressure never seems to get very high.',
    faults: [{ part: 'mech.governor', kind: 'stuck', value: 100 }], found: 'The governor check shows cut-out at about 100 psi and cut-in at about 80 psi.' },
  { id: 'purgeStuck', label: 'Air dryer purge valve stuck open', complaint: 'Constant air blowing under the cab while the engine runs; air builds very slowly or not at all.',
    faults: [{ part: 'mech.airDryerPurge', kind: 'stuck' }], found: 'The tanks hold fine with the engine off (the dryer check valve holds), but the build-up test fails and air blows from the purge valve while the compressor pumps.' },
  { id: 'dryerSaturated', label: 'Air dryer desiccant saturated', complaint: 'Water spits out of the brake valves on cold mornings.',
    faults: [{ part: 'mech.airDryer', kind: 'damaged' }], found: 'Every pressure test passes. Draining the tanks gives a lot of milky water: the dryer cartridge needs replacing.' },
  { id: 'parkValveLow', label: 'Park control valve pops out too late', complaint: 'Found during an annual inspection.',
    faults: [{ part: 'mech.parkValve', kind: 'stuck', value: 12 }], found: 'Fanning the brakes, the knob doesn\'t pop out until about 12 psi (it must pop between 20 and 45 psi).' },
  { id: 'slackRear', label: 'Left rear brake out of adjustment', complaint: 'Long stopping distances when loaded.',
    faults: [{ part: 'mech.slack.lr', kind: 'drift', value: 2.3 }], found: 'Pushrod stroke at the left rear is about 2.3" on a Type 30 chamber; the limit is 2". Check the automatic slack adjuster and the foundation brake.' },
  { id: 'slackFront', label: 'Right front brake out of adjustment', complaint: 'The truck pulls left under hard braking.',
    faults: [{ part: 'mech.slack.rf', kind: 'drift', value: 2.0 }], found: 'Pushrod stroke at the right front is about 2" on a Type 20 chamber; the limit is 1¾".' },
  { id: 'gaugeHigh', label: 'Primary pressure sensor reading high', complaint: 'The primary gauge reads higher than the secondary all the time.',
    faults: [{ part: 'airp.sensor', kind: 'drift', value: 1.25 }], found: 'A master gauge at the primary tank reads about 20% less than the dash. Every air test passes: the sensor (an electrical part read by the cluster) is wrong, not the air system. If the secondary circuit failed too, this sensor would warn late.' },
];
