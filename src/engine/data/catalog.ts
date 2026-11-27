// Reference tables extracted verbatim from J1939 Network & Fault Code Simulator 5.5 (index.html).
// Component catalog: SPNs, FMIs, lamps, readings, causes, diagnostic steps and effects.
// Only type annotations were added; the text and numbers are unchanged.

export type Lamps = string; // any of 'A' amber, 'M' MIL, 'R' red stop, 'P' protect
export interface CatalogFault {
  key: string;
  label: string;
  fmi: number;
  lamps: Lamps;
  err?: boolean;
  cond?: number;
  reading: string;
  causes: string[];
  steps: string[];
  note?: string;
  effect?: string;
}
export interface Component {
  id: string;
  ecu: EcuKey;
  label: string;
  name: string;
  spn: number;
  spnName: string;
  obd?: number;
  smart?: number;
  cyl?: number;
  type?: string;
  faults: CatalogFault[];
}
export type EcuKey = 'ecm' | 'acm' | 'tcm' | 'abs' | 'clu' | 'tool';
export interface EcuInfo { sa: number; name: string; saName: string; color: string }

export const FMI: Record<number, string> ={0:'Data valid but above normal operational range – most severe level',1:'Data valid but below normal operational range – most severe level',2:'Data erratic, intermittent or incorrect',3:'Voltage above normal, or shorted to high source',4:'Voltage below normal, or shorted to low source',5:'Current below normal or open circuit',6:'Current above normal or grounded circuit',7:'Mechanical system not responding or out of adjustment',8:'Abnormal frequency or pulse width or period',9:'Abnormal update rate',10:'Abnormal rate of change',11:'Root cause not known',12:'Bad intelligent device or component',13:'Out of calibration',14:'Special instructions',15:'Data valid but above normal operating range – least severe level',16:'Data valid but above normal operating range – moderately severe level',17:'Data valid but below normal operating range – least severe level',18:'Data valid but below normal operating range – moderately severe level',19:'Received network data in error',20:'Data drifted high',21:'Data drifted low',31:'Condition exists'};
export const ECUS: Record<EcuKey, EcuInfo> = {
 ecm:{sa:0,name:'Engine ECM',saName:'Engine #1',color:'#e6e6e9'},
 acm:{sa:61,name:'Aftertreatment ACM',saName:'Exhaust Emission Controller',color:'#b197fc'},
 tcm:{sa:3,name:'Transmission TCM',saName:'Transmission #1',color:'#69db7c'},
 abs:{sa:11,name:'ABS ECU',saName:'Brakes – System Controller',color:'#ff6b6b'},
 clu:{sa:23,name:'Instrument Cluster',saName:'Instrument Cluster #1',color:'#6fd3ff'},
 tool:{sa:249,name:'Service Tool',saName:'Off-board Diagnostic-Service Tool #1',color:'#adb5bd'},
};
export const SA2ECU: Record<number, EcuKey> = {} as Record<number, EcuKey>;for (const k of Object.keys(ECUS) as EcuKey[]) SA2ECU[ECUS[k].sa] = k;

// generic fault templates
const STEPS_5V_GND=['Key on, engine off: at the sensor harness connector, check the 5 V reference (≈5 V) and sensor ground (<0.2 V drop to battery −).','Unplug the sensor. If the code changes to FMI 3 (high), the sensor itself was shorted, so replace it. If it stays FMI 4, the signal wire is shorted to ground in the harness.','If several 5 V sensors set FMI 4 at once, look for a shorted 5 V reference circuit shared by those sensors.'];
const STEPS_5V_HIGH=['Unplug the sensor. If the signal still reads high, the signal wire is shorted to the 5 V reference or to battery voltage in the harness.','Check the sensor ground circuit: an open ground can also pull the signal high.','Check for chafed wires where the harness passes hot or sharp components.'];
const STEPS_OPEN=['Inspect the connector: backed-out or spread terminals, corrosion, water intrusion. Do a pin-drag test.','Check continuity of each wire from the ECM connector to the sensor connector (key off, both ends unplugged): it should be under about 5 Ω.','Wiggle-test the harness while watching live data.'];
const STEPS_ERR=['Graph live data and wiggle the harness and connectors; look for dropouts.','Check terminals for fretting/corrosion and the harness for chafing.','Check that the harness is routed away from injector and alternator wiring (electrical noise).'];
function circuitFaults(c: Component, openFmi: number): CatalogFault[] {
  const L=c.obd?'AM':'A';
  return[
   {key:'gnd',label:'Signal shorted to ground',fmi:4,lamps:L,err:true,reading:'Signal ≈ 0.05 V (valid range is about 0.5–4.5 V)',causes:['Signal wire chafed through to ground','Sensor shorted internally','Water in the connector'],steps:STEPS_5V_GND},
   {key:'high',label:'Signal shorted to 5 V / battery',fmi:3,lamps:L,err:true,reading:'Signal ≈ 4.97 V (above the 4.75 V limit)',causes:['Signal wire shorted to the 5 V reference or to battery voltage','Open sensor ground','Failed sensor'],steps:STEPS_5V_HIGH},
   {key:'open',label:'Open signal wire / unplugged',fmi:openFmi,lamps:L,err:true,reading:openFmi===4?'Signal ≈ 0.0 V. An open signal is pulled low by the ECM\'s pull-down resistor.':'Signal ≈ 4.9 V. An open signal is pulled high by the ECM\'s pull-up resistor.',causes:['Connector unplugged or terminal backed out','Broken wire','Open inside the sensor'],steps:STEPS_OPEN,note:'Whether an open circuit reads high (FMI 3) or low (FMI 4) depends on whether the module uses a pull-up or pull-down resistor on that input. Check the OEM troubleshooting guide.'},
   {key:'erratic',label:'Intermittent connection',fmi:2,lamps:L,err:true,reading:'Signal jumps around and does not match related readings',causes:['Loose or corroded terminal','Wire broken inside insulation','Electrical noise'],steps:STEPS_ERR},
  ];
}
function tempFaults(c: Component): CatalogFault[] {
  const L=c.obd?'AM':'A';
  return[
   {key:'open',label:'Open circuit / unplugged',fmi:3,lamps:L,err:true,reading:'Signal ≈ 4.9 V. With the pull-up, an open thermistor reads as extremely cold (about −40 °C).',causes:['Unplugged connector','Broken wire','Open thermistor'],steps:['Unplug the sensor and jumper signal to return at the harness: the reading should swing to very hot (FMI 4). If it does, the harness is good, so replace the sensor.','Check thermistor resistance against the OEM temperature chart.'],note:'A thermistor (NTC) sensor has <b>low</b> resistance when hot and high resistance when cold.'},
   {key:'gnd',label:'Signal shorted to ground',fmi:4,lamps:L,err:true,reading:'Signal ≈ 0.05 V, which reads as impossibly hot',causes:['Signal wire shorted to ground','Shorted sensor'],steps:['Unplug the sensor: the reading should go to −40 °C (FMI 3). If it stays hot, the harness is shorted to ground.']},
  ];
}
const SPEED_STEPS=['Measure sensor resistance at the sensor and at the module connector (compare with OEM spec; magnetic/VR sensors are usually hundreds to a few thousand ohms).','Crank or spin the wheel and measure AC output voltage, or scope the signal: look for missing or distorted pulses.','Check air gap, sensor mounting and the tone wheel for damage, debris or runout.'];
function speedFaults(_c: Component): CatalogFault[] {
  return[
   {key:'open',label:'Open circuit / no signal',fmi:5,lamps:'A',err:true,reading:'No pulses; circuit resistance reads open',causes:['Broken wire or unplugged connector','Open sensor coil'],steps:SPEED_STEPS},
   {key:'erratic',label:'Erratic signal',fmi:2,lamps:'A',err:true,reading:'Pulses missing or extra; speed jumps',causes:['Damaged or dirty tone wheel','Loose sensor (air gap changes)','Electrical noise or chafed shielding'],steps:SPEED_STEPS},
  ];
}

// ===================== components =====================
// each: id, ecu, label (short, for diagram), name, spn, spnName, obd (emissions-related → MIL), faults
export const C: Component[] = [];
function comp(o: Component): Component {o.faults=o.faults||[];C.push(o);return o;}
// ---- Engine ECM ----
comp({id:'crank',ecu:'ecm',label:'Crank',name:'Crankshaft position sensor',spn:190,spnName:'Engine Speed (crankshaft speed/position)',type:'speed',faults:[
 {key:'open',label:'Open circuit / no signal',fmi:5,lamps:'A',reading:'No crank pulses; the ECM switches to the cam signal as a backup',causes:['Unplugged or damaged connector','Open sensor coil or wire'],steps:SPEED_STEPS,effect:'Engine keeps running on the cam sensor (backup timing) with reduced power and possible hard starting. If the cam sensor also fails, the engine stalls.'},
 {key:'erratic',label:'Erratic signal (tone wheel / noise)',fmi:2,lamps:'A',reading:'Crank signal drops teeth; speed jumps',causes:['Damaged tone wheel','Sensor loose or wrong air gap','Electrical noise'],steps:SPEED_STEPS,effect:'Rough running and possible stalling.'},
]});
comp({id:'cam',ecu:'ecm',label:'Cam',name:'Camshaft position sensor',spn:723,spnName:'Engine Speed 2 (camshaft speed/position)',type:'speed',faults:[
 {key:'open',label:'Open circuit / no signal',fmi:5,lamps:'A',reading:'No cam pulses',causes:['Unplugged connector','Open sensor or wire'],steps:SPEED_STEPS,effect:'A running engine usually keeps running on the crank signal. After shutdown, expect a long crank or no start until the ECM can sync. If the crank sensor also fails, the engine stalls.'},
 {key:'sync',label:'Cam/crank out of sync',fmi:7,lamps:'A',reading:'Cam and crank signals do not line up as expected',causes:['Timing gear installed one tooth off','Worn/jumped gear train or damaged target wheel'],steps:['Verify gear-train timing marks and backlash per OEM.','Compare cam and crank signals on a two-channel scope.'],effect:'Hard start and possible derate.'},
]});
comp({id:'map',ecu:'ecm',label:'MAP',name:'Intake manifold (boost) pressure sensor',spn:102,spnName:'Engine Intake Manifold #1 Pressure',obd:1,faults:[]});
comp({id:'maf',ecu:'ecm',label:'MAF',name:'Mass air flow sensor',spn:132,spnName:'Engine Intake Air Mass Flow Rate',obd:1,faults:[]});
comp({id:'oilp',ecu:'ecm',label:'Oil P',name:'Engine oil pressure sensor',spn:100,spnName:'Engine Oil Pressure',faults:[]});
comp({id:'ect',ecu:'ecm',label:'Coolant T',name:'Engine coolant temperature sensor',spn:110,spnName:'Engine Coolant Temperature',faults:[]});
comp({id:'rail',ecu:'ecm',label:'Rail P',name:'Fuel rail pressure sensor',spn:157,spnName:'Engine Injector Metering Rail 1 Pressure',obd:1,faults:[]});
comp({id:'app',ecu:'ecm',label:'Pedal',name:'Accelerator pedal position sensor',spn:91,spnName:'Accelerator Pedal Position 1',faults:[]});
comp({id:'thr',ecu:'ecm',label:'Throttle',name:'Intake throttle valve position sensor',spn:51,spnName:'Engine Throttle Valve 1 Position 1',obd:1,faults:[]});
comp({id:'egr',ecu:'ecm',label:'EGR pos',name:'EGR valve position sensor',spn:27,spnName:'Engine Exhaust Gas Recirculation 1 Valve Position',obd:1,faults:[]});
comp({id:'vgt',ecu:'ecm',label:'VGT pos',name:'VGT actuator position sensor',spn:2795,spnName:'Engine Variable Geometry Turbocharger Actuator #1 Position',obd:1,faults:[]});
comp({id:'batt',ecu:'ecm',label:'Battery',name:'Battery voltage (ECM supply)',spn:168,spnName:'Battery Potential / Power Input 1',faults:[
 {key:'low',label:'Low system voltage',fmi:18,lamps:'A',cond:1,reading:'11.4 V while running (expected about 13.5–14.2 V)',causes:['Alternator not charging','Loose or corroded battery cables','Weak batteries'],steps:['Load-test the batteries and check charging voltage at the batteries.','Voltage-drop test the positive and negative cables under load.'],effect:'Modules may reset or set communication codes; injector drive can be affected.'},
 {key:'high',label:'High system voltage',fmi:16,lamps:'A',cond:1,reading:'16.3 V on a 12 V system',causes:['Faulty alternator voltage regulator'],steps:['Check alternator output and its sense/regulator circuit.'],effect:'Risk of damage to modules and bulbs.'},
]});
comp({id:'sup1',ecu:'ecm',label:'5V sup 1',name:'5 V sensor supply 1 (MAP, rail pressure, throttle & EGR position)',spn:3509,spnName:'Sensor Supply Voltage 1',obd:1,faults:[
 {key:'gnd',label:'5 V ref shorted to ground',fmi:4,lamps:'AM',reading:'Supply 1 reads ≈ 0.1 V (should be 5.0 V)',causes:['5 V reference wire chafed to ground somewhere in the harness','One sensor on that supply shorted internally, pulling the whole supply down'],steps:['Key ON: measure the 5 V ref at the MAP and at the rail pressure sensor connectors. Both read low because they share the supply.','Unplug the sensors on that supply one at a time. If the 5 V comes back when one is unplugged, that sensor is shorted.','If it stays low with all of them unplugged, the short is in the harness.'],effect:'Every sensor on supply 1 (MAP and rail pressure) loses its reference at the same time. The ECM sets the supply code, broadcasts error indicators for those sensors and derates power. Some ECMs also set a separate code for each sensor on the supply.'},
 {key:'high',label:'5 V ref shorted to battery',fmi:3,lamps:'AM',reading:'Supply 1 reads ≈ battery voltage',causes:['5 V reference chafed against a 12 V circuit'],steps:['Key ON: measure the 5 V ref. Near battery voltage means a short to a 12 V circuit.','After repair, check the sensors on that supply for overvoltage damage.'],effect:'Sensors on supply 1 read out of range; possible sensor damage.'}]});
comp({id:'sup2',ecu:'ecm',label:'5V sup 2',name:'5 V sensor supply 2 (oil pressure, MAF & VGT position)',spn:3510,spnName:'Sensor Supply Voltage 2',obd:1,faults:[
 {key:'gnd',label:'5 V ref shorted to ground',fmi:4,lamps:'AM',reading:'Supply 2 reads ≈ 0.1 V (should be 5.0 V)',causes:['5 V reference wire chafed to ground','A shorted sensor on supply 2'],steps:['Key ON: measure the 5 V ref at the oil pressure and MAF connectors.','Unplug the sensors on that supply one at a time and watch the 5 V ref.'],effect:'Oil pressure and MAF readings are lost together. The oil gauge shows an error and <b>engine protection for oil pressure is lost</b>.'},
 {key:'high',label:'5 V ref shorted to battery',fmi:3,lamps:'AM',reading:'Supply 2 reads ≈ battery voltage',causes:['5 V reference chafed against a 12 V circuit'],steps:['Key ON: measure the 5 V ref; look for a chafe against a 12 V wire.'],effect:'Oil pressure and MAF read out of range.'}]});
for(let i=1;i<=6;i++)comp({id:'inj'+i,ecu:'ecm',label:'Inj '+i,name:`Injector, cylinder ${i}`,spn:650+i,spnName:`Engine Injector Cylinder #0${i}`,obd:1,cyl:i,faults:[
 {key:'open',label:'Open circuit',fmi:5,lamps:'AM',reading:'No current flows when the ECM fires this injector',causes:['Open injector coil','Broken wire or terminal (often under the valve cover)','Connector not seated'],steps:['Measure injector coil resistance at the ECM harness connector and compare with spec (usually below 2 Ω for solenoid injectors).','If it reads open, recheck at the injector to separate harness from injector.','Inspect the under-cover harness and pass-through connector.'],effect:`Cylinder ${i} does not fire: misfire, rough running, power loss, extra white smoke at idle.`},
 {key:'short',label:'Shorted / grounded circuit',fmi:6,lamps:'AM',reading:'Current rises too fast or flows to ground',causes:['Injector wire chafed to ground or to the other injector wire','Shorted injector coil'],steps:['Check each injector wire to engine ground (should be open, megohms).','Check coil resistance (a very low reading means a shorted coil).'],effect:'The ECM turns off that driver, and sometimes its whole bank, which can disable several cylinders.'},
 {key:'mech',label:'Mechanical / low contribution',fmi:7,lamps:'AM',reading:'Circuit OK, but this cylinder adds little speed when it fires',causes:['Sticking or worn injector','Low compression (valve, ring, head gasket)'],steps:['Run the cylinder cutout / balance test with the service tool.','Do a compression or relative-compression test before replacing the injector.'],effect:'Rough idle and misfire on that cylinder.'},
]});
// fill generic sensor faults + condition faults
function add(id: string, arr: CatalogFault[]): void {const c=C.find(x=>x.id===id)!;c.faults=c.faults.concat(arr);}
add('map',circuitFaults(C.find(c=>c.id==='map')!,4));
add('map',[{key:'over',label:'Real condition: overboost',fmi:16,lamps:'AM',cond:1,reading:'Boost reads 38 psi; the sensor is fine and boost really is too high',causes:['VGT vanes or actuator sticking closed','Wastegate stuck closed','Turbo speed sensor or actuator calibration'],steps:['Compare the MAP reading with barometric pressure at key-on, engine off (should match within about 1.5 psi).','Check the VGT actuator and vanes for sticking.'],effect:'Engine derate to protect the turbo and engine.'},
 {key:'under',label:'Real condition: low boost',fmi:18,lamps:'AM',cond:1,reading:'Boost reads 8 psi under load',causes:['Charge-air cooler or boost hose leak','Turbo damage','Restricted air filter','Exhaust leak before the turbo'],steps:['Pressure-test the charge-air system.','Check air filter restriction and the turbo.'],effect:'Low power and black smoke.'}]);
add('maf',circuitFaults(C.find(c=>c.id==='maf')!,4));
add('maf',[{key:'drh',label:'Sensor drifted high',fmi:20,lamps:'AM',cond:1,reading:'MAF reads higher than the ECM\'s model predicts',causes:['Contaminated or failing sensing element','Air leak after the MAF changing the flow pattern'],steps:['Compare MAF with expected airflow at a known speed and load (OEM spec).','Inspect the element and the intake for leaks; run the OEM MAF calibration/verification test.'],effect:'EGR and fueling errors; NOx can rise.'},
 {key:'drl',label:'Sensor drifted low',fmi:21,lamps:'AM',cond:1,reading:'MAF reads lower than the ECM\'s model predicts',causes:['Dirty element','Restricted air filter or intake'],steps:['Check air filter restriction.','Inspect and test the MAF per OEM.'],effect:'Smoke and possible derate.'}]);
add('oilp',circuitFaults(C.find(c=>c.id==='oilp')!,4));
add('oilp',[{key:'low',label:'Real condition: low oil pressure',fmi:1,lamps:'R',cond:1,reading:'Oil pressure 9 psi at 1450 rpm. The sensor is reading correctly.',causes:['Low oil level','Worn main/rod bearings','Weak or failed oil pump / stuck relief valve','Fuel dilution or wrong viscosity'],steps:['Stop the engine. Check oil level and condition.','<b>Verify with a mechanical gauge</b> before condemning the sensor.','Inspect the pickup, pump and relief valve; then check bearing clearances.'],effect:'Red STOP lamp. Engine protection derates power and may shut the engine down if shutdown is enabled.'}]);
add('ect',tempFaults(C.find(c=>c.id==='ect')!));
add('ect',[{key:'hot',label:'Real condition: overheating',fmi:0,lamps:'R',cond:1,reading:'Coolant 234 °F (112 °C). The sensor is reading correctly.',causes:['Low coolant level / leak','Fan clutch not engaging','Stuck thermostat','Failed water pump','Plugged radiator or charge-air cooler stack'],steps:['Verify with an infrared thermometer or a second gauge.','Pressure-test the cooling system; check fan clutch engagement and the thermostat.'],effect:'Red STOP lamp; engine protection derate or shutdown.'},
 {key:'warm',label:'Real condition: running hot',fmi:16,lamps:'A',cond:1,reading:'Coolant 220 °F (104 °C)',causes:['Same as overheating, just less severe'],steps:['Check coolant level, fan engagement and the radiator.'],effect:'Amber lamp, possible derate.'}]);
add('rail',circuitFaults(C.find(c=>c.id==='rail')!,4));
add('rail',[{key:'lowp',label:'Real condition: low rail pressure',fmi:18,lamps:'AM',cond:1,reading:'Rail pressure 90 MPa; 160 MPa was commanded',causes:['Plugged fuel filters','Air in the fuel or a suction-side leak','Worn high-pressure pump','Leaking injector return or pressure relief valve'],steps:['Check fuel filter restriction and look for air in the fuel.','Measure injector return flow and the relief valve leak-off per OEM.'],effect:'Loss of power, hard starting, possible derate.'}]);
add('app',circuitFaults(C.find(c=>c.id==='app')!,4).map(f=>Object.assign(f,{effect:'The engine ignores the pedal and goes to idle or a fixed limp-home speed.'})));add('thr',circuitFaults(C.find(c=>c.id==='thr')!,4));
add('thr',[{key:'stuck',label:'Real condition: throttle valve sticking',fmi:7,lamps:'AM',cond:1,reading:'Throttle commanded 100% open; actual position 35%. The sensor is reading correctly.',causes:['Oily soot build-up on the throttle plate and bore (crankcase vent oil plus EGR soot)','Failed actuator motor or gear train'],steps:['Run the intake throttle actuator test with the service tool and compare commanded and actual position.','Remove the intake hose and inspect the plate for build-up and binding.','If the intake is oily, check the crankcase ventilation separator.'],effect:'Low power and black smoke: the engine can\'t get enough air. Regeneration can also suffer, because the throttle is used to raise exhaust temperature.'}]);
add('egr',circuitFaults(C.find(c=>c.id==='egr')!,4));
add('egr',[{key:'stuck',label:'Real condition: EGR valve sticking',fmi:7,lamps:'AM',cond:1,reading:'EGR valve commanded closed; actual position stays at 45% open. The sensor is reading correctly.',causes:['Carbon build-up on the valve stem and seat','Coolant leaking from the EGR cooler, leaving sticky deposits','Failed actuator'],steps:['Run the EGR valve actuator test and compare commanded and actual position.','Remove the valve and inspect the valve, seat and stem for carbon.','Check the EGR cooler for coolant leaks (white residue, coolant loss).'],effect:'Stuck open: low power, black smoke and rough idle. Stuck closed: NOx rises and the SCR has to work harder (possible NOx conversion codes).'}]);
add('vgt',circuitFaults(C.find(c=>c.id==='vgt')!,4));
add('vgt',[{key:'stuck',label:'Real condition: VGT vanes sticking',fmi:7,lamps:'AM',cond:1,reading:'VGT commanded 80% closed; actual position stops at 15%. The sensor is reading correctly.',causes:['Soot build-up on the vanes and unison ring','Vane linkage seized from heat','Actuator motor or gear failure'],steps:['Run the VGT actuator sweep / learn test with the service tool.','Remove the actuator and move the vane linkage by hand: it should move smoothly through full travel.','Look for the source of excess soot (EGR, injector or air filter problems).'],effect:'Stuck open: low boost, low power and black smoke. Stuck closed: overboost, high back pressure and high exhaust temperature; the ECM derates.'}]);

// ---- ACM ----
comp({id:'noxin',ecu:'acm',label:'NOx in',name:'Inlet (engine-out) NOx sensor',spn:3216,spnName:'Aftertreatment 1 Intake NOx',obd:1,smart:1,faults:[]});
comp({id:'noxout',ecu:'acm',label:'NOx out',name:'Outlet (tailpipe) NOx sensor',spn:3226,spnName:'Aftertreatment 1 Outlet NOx',obd:1,smart:1,faults:[]});
['noxin','noxout'].forEach(id=>add(id,[
 {key:'nocom',label:'Lost communication (smart sensor)',fmi:9,lamps:'AM',err:true,reading:'No NOx messages from the sensor\'s control box',causes:['Lost power or ground to the NOx sensor module','Open/shorted CAN wires to the sensor','Failed sensor module'],steps:['NOx sensors are smart sensors that talk CAN: check power, ground and CAN-H/CAN-L at the sensor module.','Check for terminating resistors on the aftertreatment sub-network (should measure about 60 Ω).'],effect:'SCR efficiency can\'t be monitored. MIL, then inducement derates if not repaired.'},
 {key:'drift',label:'Reading drifted high',fmi:20,lamps:'AM',cond:1,reading:'NOx reads far above what the ECM\'s model predicts',causes:['Aging sensor','Exhaust leak near the sensor','DEF deposits on the sensor','(Outlet) real low SCR efficiency: poor DEF quality or under-dosing'],steps:['Compare inlet and outlet NOx during an OEM SCR performance test.','Check DEF quality with a refractometer (32.5% urea).','Inspect for exhaust leaks and deposits.'],effect:'MIL. Repeated SCR-efficiency faults lead to inducement derates.'},
 {key:'internal',label:'Sensor internal fault',fmi:12,lamps:'AM',err:true,reading:'The sensor module reports an internal heater or element failure',causes:['Failed sensor element or heater','Moisture/thermal shock'],steps:['Confirm power and ground, then replace the sensor per OEM.'],effect:'MIL; NOx monitoring lost.'},
]));
comp({id:'def',ecu:'acm',label:'DEF level',name:'DEF tank level sensor',spn:1761,spnName:'Aftertreatment 1 Diesel Exhaust Fluid Tank Volume',obd:1,faults:[
 {key:'low',label:'Real condition: DEF low',fmi:17,lamps:'A',cond:1,reading:'DEF tank 8%',causes:['Tank needs filling'],steps:['Fill with ISO 22241 DEF.'],effect:'DEF gauge warning. If it keeps dropping, inducement starts.'},
 {key:'empty',label:'Real condition: DEF empty',fmi:1,lamps:'AM',cond:1,reading:'DEF tank 0%',causes:['Tank empty'],steps:['Fill the tank. The derate clears once the level is restored and the system verifies it.'],effect:'Inducement: progressive power derate, ending in a 5 mph limit on many trucks.'},
 {key:'high',label:'Sensor circuit high',fmi:3,lamps:'AM',err:true,reading:'Level sensor signal above range',causes:['Signal shorted high or open ground'],steps:STEPS_5V_HIGH},
 {key:'gnd',label:'Sensor circuit low',fmi:4,lamps:'AM',err:true,reading:'Level sensor signal below range',causes:['Signal shorted to ground'],steps:STEPS_5V_GND},
]});
comp({id:'dpf',ecu:'acm',label:'DPF ΔP',name:'DPF differential pressure sensor',spn:3251,spnName:'Aftertreatment 1 DPF Differential Pressure',obd:1,faults:[]});
add('dpf',circuitFaults(C.find(c=>c.id==='dpf')!,4).slice(0,3));
add('dpf',[{key:'soot',label:'Real condition: high soot load',fmi:16,lamps:'AM',cond:1,reading:'ΔP 12 kPa at this exhaust flow, above the regen threshold',causes:['Missed or interrupted regenerations','Short-trip duty cycle','Engine making excess soot (injector, EGR, boost faults)'],steps:['Run a parked/stationary regeneration.','Find out why active regens aren\'t completing: check related engine codes and DOC inlet temperature.'],effect:'Regen request lamp; derate if the soot load keeps rising.'},
 {key:'plug',label:'Real condition: DPF plugged',fmi:0,lamps:'AMR',cond:1,reading:'ΔP 30 kPa, far above normal',causes:['Excess soot that can no longer be safely regenerated','Ash loading (DPF needs cleaning)'],steps:['Do not force a regen at very high soot loads; follow OEM instructions.','Remove the DPF for cleaning or replacement.'],effect:'Severe derate. Red lamp on some trucks.'}]);
// ---- TCM ----
comp({id:'oss',ecu:'tcm',label:'Output speed',name:'Transmission output shaft speed sensor',spn:191,spnName:'Transmission Output Shaft Speed',faults:[]});
add('oss',speedFaults(C.find(c=>c.id==='oss')!).map(f=>Object.assign(f,{effect:'TCM holds a gear or goes to limp mode. Because the ECM calculates road speed from the output shaft speed in ETC1, <b>the speedometer drops out</b> and cruise control won\'t work.'})));
comp({id:'tot',ecu:'tcm',label:'Trans oil T',name:'Transmission oil temperature sensor',spn:177,spnName:'Transmission Oil Temperature 1',faults:[]});
add('tot',tempFaults(C.find(c=>c.id==='tot')!));
add('tot',[{key:'hot',label:'Real condition: trans overheating',fmi:16,lamps:'A',cond:1,reading:'Trans oil 266 °F (130 °C)',causes:['Low fluid level','Restricted trans cooler','Retarder overuse or slipping clutches'],steps:['Check fluid level and condition.','Check cooler flow and temperature drop.'],effect:'Amber lamp; the TCM may change its shift strategy to cool down.'}]);
// ---- ABS ----
const WSS=[['wlf','LF wheel','Steer axle left',789],['wrf','RF wheel','Steer axle right',790],['wlr','LR wheel','Drive axle left',791],['wrr','RR wheel','Drive axle right',792]];
const WSS_STEPS=['Measure sensor resistance at the ECU harness connector (Bendix WS-24: about 1500–2500 Ω) and check each wire to ground (should be open).','Spin the wheel at about 0.5 rev/s: AC output should be at least 0.25 V (Bendix spec).','Push the sensor against the tone ring (it adjusts through its clamping sleeve) and check wheel bearing endplay and the tone ring for damage.'];
(WSS as [string,string,string,number][]).forEach(([id,label,pos,spn],i)=>comp({id,ecu:'abs',label,name:`Wheel speed sensor, ${pos}`,spn,spnName:`Wheel Sensor ABS Axle ${i<2?1:2} ${i%2?'Right':'Left'}`,faults:[
 {key:'open',label:'Open circuit',fmi:5,lamps:'A',err:true,reading:'Sensor resistance reads open',causes:['Broken wire (common near the wheel end)','Unplugged connector','Open sensor coil'],steps:WSS_STEPS},
 {key:'short',label:'Shorted / grounded circuit',fmi:6,lamps:'A',err:true,reading:'Low resistance or wire shorted to ground',causes:['Chafed wire','Shorted sensor coil'],steps:WSS_STEPS},
 {key:'gap',label:'Excessive air gap / low output',fmi:1,lamps:'A',reading:'AC output too low at speed',causes:['Sensor pushed back from the tone ring','Wheel bearing endplay','Worn clamping sleeve'],steps:WSS_STEPS},
 {key:'erratic',label:'Erratic signal',fmi:8,lamps:'A',reading:'Wheel speed jumps compared with the other wheels',causes:['Damaged or dirty tone ring','Loose sensor','Wrong tire size on one axle'],steps:WSS_STEPS},
].map(f=>Object.assign(f,{effect:'ABS lamp ON. ABS is turned off for that wheel (often the whole axle or system) and traction control (ATC) is disabled. <b>Normal service braking still works.</b>'}))}));
comp({id:'abspwr',ecu:'abs',label:'ABS power',name:'ABS ECU supply voltage',spn:627,spnName:'Power Supply',faults:[
 {key:'low',label:'Supply voltage low',fmi:4,lamps:'A',reading:'9.4 V at the ABS ECU while the batteries read 13.9 V',causes:['Corroded fuse or power feed connector','High resistance in the ABS ground'],steps:['Voltage-drop test the ABS power and ground circuits under load (with modulators cycling).','Check the fuse, the ignition feed and the ground eyelet.'],effect:'ABS lamp ON, ABS disabled, possible blink codes. Normal braking remains.'},
]});
// ---- Cluster ----
comp({id:'fuel',ecu:'clu',label:'Fuel level',name:'Fuel level sender',spn:96,spnName:'Fuel Level 1',faults:[
 {key:'open',label:'Open circuit',fmi:3,lamps:'A',err:true,reading:'Sender circuit reads open (high voltage)',causes:['Broken sender wire or ground','Failed sender resistor card'],steps:['Measure sender resistance at the tank (compare with the OEM empty/full values).','Check the sender ground.'],effect:'Fuel gauge pegs to an end or shows dashes.'},
 {key:'gnd',label:'Shorted to ground',fmi:4,lamps:'A',err:true,reading:'Sender circuit reads shorted',causes:['Wire chafed to frame'],steps:['Unplug the sender: the reading should go open (FMI 3). If not, the harness is shorted.'],effect:'Fuel gauge reads wrong or shows dashes.'},
 {key:'float',label:'Real condition: sender float stuck / sunk',fmi:2,lamps:'A',cond:1,reading:'Sender reports empty (about 240 Ω) while the tank is about 3/4 full. The level never changes as fuel is burned.',causes:['Float has a pinhole and filled with fuel','Float arm bent or binding against the tank wall'],steps:['Look in the tank and compare the real level with the gauge.','Remove the sender and sweep the float through its travel while measuring resistance.'],effect:'Fuel gauge reads empty or never moves. (Some clusters flag a level that doesn\'t change while fuel is being used.)'},
]});
// ---- added chassis components ----
const AIR_LOW=(w: string): CatalogFault=>({key:'low',label:`Real condition: low ${w} air`,fmi:1,lamps:'R',cond:1,reading:`${w[0].toUpperCase()+w.slice(1)} air 55 psi with the engine running. The sensor is reading correctly.`,causes:['Air leak in that circuit (fittings, chambers, valves)','Air dryer purge valve stuck open','Compressor or governor not building pressure'],steps:['Verify with a master air gauge at the tank before condemning the sensor.','Leak-down test: engine off, brakes released; loss should be under about 2 psi per minute (tractor only).','Check governor cut-out (about 125 psi) and cut-in (about 105 psi) and the build-up time.'],effect:'Low-air warning lamp and buzzer. Below about 60 psi the spring brakes can start to apply. <b>Don\'t move the truck until it\'s fixed.</b>'});
comp({id:'airp',ecu:'clu',label:'Air prim',name:'Primary air tank pressure sensor',spn:117,spnName:'Brake Primary Pressure',faults:[]});
add('airp',circuitFaults(C.find(c=>c.id==='airp')!,4));add('airp',[AIR_LOW('primary')]);
comp({id:'airs',ecu:'clu',label:'Air sec',name:'Secondary air tank pressure sensor',spn:118,spnName:'Brake Secondary Pressure',faults:[]});
add('airs',circuitFaults(C.find(c=>c.id==='airs')!,4));add('airs',[AIR_LOW('secondary')]);
comp({id:'amb',ecu:'clu',label:'Ambient T',name:'Ambient air temperature sensor',spn:171,spnName:'Ambient Air Temperature',faults:[]});
add('amb',tempFaults(C.find(c=>c.id==='amb')!));
comp({id:'iss',ecu:'tcm',label:'Input speed',name:'Transmission input shaft speed sensor',spn:161,spnName:'Transmission Input Shaft Speed',faults:[]});
add('iss',speedFaults(C.find(c=>c.id==='iss')!).map(f=>Object.assign(f,{effect:'The TCM can\'t check clutch engagement or gear ratios. Expect harsh or missed shifts, a held gear or limp mode, and a transmission service lamp.'})));
comp({id:'deft',ecu:'acm',label:'DEF temp',name:'DEF tank temperature sensor',spn:3031,spnName:'Aftertreatment 1 Diesel Exhaust Fluid Tank Temperature 1',obd:1,faults:[]});
add('deft',tempFaults(C.find(c=>c.id==='deft')!));
// set default effects
C.forEach(c=>c.faults.forEach(f=>{
  if(!f.effect){
    const m: Record<string, string>={thr:'The ECM moves the throttle to a default (open) position; regeneration control is degraded. MIL on.',egr:'The ECM closes the EGR valve as a fail-safe. NOx rises and the MIL comes on; power may be limited.',vgt:'The ECM parks the VGT in a default position: boost control is degraded and power is reduced.',map:'Reduced power: the ECM substitutes a default boost value and limits fueling.',maf:'The ECM uses a modeled airflow value; EGR control is degraded and NOx may rise.',oilp:'The oil pressure gauge shows an error and <b>engine protection for oil pressure is lost</b>.',ect:'The ECM substitutes a default temperature; the fan may run all the time; the gauge shows an error.',rail:'The ECM goes to a limp-home rail pressure; power is reduced.',app:'',noxin:'',noxout:'',def:'DEF gauge shows an error; MIL.',dpf:'Regen control is degraded; MIL.',tot:'The TCM uses a default temperature; it may change shift strategy.',fuel:'',airp:'The primary air gauge shows an error or reads wrong, and the low-air warning from this sensor may not work. Check real air pressure with a master gauge.',airs:'The secondary air gauge shows an error or reads wrong, and the low-air warning from this sensor may not work. Check real air pressure with a master gauge.',amb:'The outside temperature display shows dashes. Modules use a default value, which can change cold-start, fan and A/C strategies.',deft:'The ACM can\'t control DEF tank heating; MIL on. In cold weather the DEF can freeze, leading to dosing faults and inducement.'};
    f.effect=m[c.id]||'See OEM fault tree.';
  }
}));


// ===================== network/wiring faults =====================
export const NETF: { key: string; label: string }[] =[
 {key:'none',label:'Wiring OK'},
 {key:'term',label:'One terminating resistor missing'},
 {key:'tcm',label:'Open in TCM stub (TCM off the bus)'},
 {key:'hl',label:'CAN-H shorted to CAN-L'},
 {key:'hg',label:'CAN-H shorted to ground'},
];

export const compById = (id: string): Component | undefined => C.find((c) => c.id === id);
export const faultOf = (cid: string, key: string): CatalogFault | undefined => compById(cid)?.faults.find((f) => f.key === key);
export function spnName(spn: number): string {
  if (spn === 639) return 'J1939 Network #1';
  const c = C.find((x) => x.spn === spn);
  return c ? c.spnName : 'SPN ' + spn;
}
/** Lamps the module requests for a code, taken from the catalog entry with the same SPN/FMI. */
export function lampsFor(cid: string, fmi: number): Lamps {
  if (cid === 'net') return 'A';
  const f = compById(cid)?.faults.find((x) => x.fmi === fmi);
  return f ? f.lamps : 'A';
}
