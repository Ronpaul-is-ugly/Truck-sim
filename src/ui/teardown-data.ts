// Text for the engine teardown bench (src/ui/engine-teardown.ts): every removable component of the inline six,
// in a realistic removal order, and the sub-parts each one comes apart into on the inspection bench.

export interface SubPart {
  id: string;
  name: string;
  does: string;
  made: string;
}
export interface TeardownPart {
  id: string;
  name: string;
  /** Parts that have to come off before this one can (they cover it or bolt through it). */
  needs: string[];
  does: string;
  made: string;
  inspect: string;
  /** How it comes off, in shop terms. */
  removal: string;
  subs: SubPart[];
}

export const TEARDOWN: TeardownPart[] = [
  {
    id: 'turbo', name: 'Turbocharger', needs: [],
    does: 'Uses exhaust energy that would otherwise go out the stack. Hot exhaust spins the turbine wheel; the compressor wheel on the same shaft packs more air into the cylinders, so more fuel can be burned cleanly. A variable geometry (VGT) turbo lets the ECM change how hard the exhaust drives the turbine.',
    made: 'Turbine housing: high-silicon-molybdenum ductile iron or cast stainless steel. Turbine wheel: nickel superalloy (Inconel-type). Compressor wheel: cast or forged aluminum. Center housing: cast iron with oil and coolant passages.',
    inspect: 'Shaft end play and radial play with a dial indicator; wheels for rub marks, bent or chipped blades; oil in the compressor outlet (worn seals); VGT linkage free and full travel.',
    removal: 'Disconnect the oil feed and drain lines and the actuator connector, remove the V-band clamps and mounting nuts, lift it off the exhaust manifold. Cap the oil lines.',
    subs: [
      { id: 'tCompHsg', name: 'Compressor housing', does: 'Collects air from the spinning compressor wheel and slows it down so speed turns into pressure (boost).', made: 'Cast aluminum.' },
      { id: 'tCompWheel', name: 'Compressor wheel', does: 'Draws filtered air in at the center and flings it outward at very high speed.', made: 'Cast or billet aluminum alloy.' },
      { id: 'tCenter', name: 'Center housing (bearing housing)', does: 'Holds the shaft bearings and carries engine oil (and on many turbos coolant) to keep them alive at 100,000+ rpm.', made: 'Gray or ductile cast iron; bronze journal bearings.' },
      { id: 'tShaft', name: 'Shaft and turbine wheel', does: 'Exhaust gas pushes the turbine blades; the shaft carries that power to the compressor wheel.', made: 'Nickel superalloy wheel friction-welded to a hardened steel shaft.' },
      { id: 'tTurbHsg', name: 'Turbine housing', does: 'Channels exhaust from the manifold onto the turbine wheel. On a VGT, movable vanes or a sliding nozzle change the flow area.', made: 'High-silicon-moly ductile iron or cast stainless steel.' },
    ],
  },
  {
    id: 'exhaustManifold', name: 'Exhaust manifold', needs: ['turbo'],
    does: 'Collects the exhaust pulses from all six cylinders and delivers them to the turbo. Split into sections with slip joints so it can grow with heat without cracking.',
    made: 'High-silicon-molybdenum (SiMo) ductile cast iron; multilayer steel gaskets; heat-resistant studs.',
    inspect: 'Cracks between ports, warped flanges (straightedge), leaking slip joints (black soot tracks), broken studs.',
    removal: 'Penetrating oil on the studs, remove the nuts in sequence, slide the sections off together.',
    subs: [
      { id: 'emFront', name: 'Front section', does: 'Collects cylinders 1 to 3.', made: 'SiMo ductile iron.' },
      { id: 'emRear', name: 'Rear section', does: 'Collects cylinders 4 to 6 and feeds the turbo.', made: 'SiMo ductile iron.' },
      { id: 'emGasket', name: 'Port gaskets', does: 'Seal each port to the head.', made: 'Multilayer stainless steel.' },
    ],
  },
  {
    id: 'intakeManifold', name: 'Intake manifold', needs: [],
    does: 'Distributes cooled, compressed air from the charge air cooler evenly to all six intake ports. Often carries the boost/intake temperature sensor and the grid heater.',
    made: 'Cast aluminum (some engines use composite plastic); rubber or silicone gaskets.',
    inspect: 'Cracks, oil or soot inside (turbo seals or EGR), gasket condition, grid heater terminals.',
    removal: 'Loosen the charge air boot clamp, unplug the sensor, remove the bolts and lift it away from the head.',
    subs: [
      { id: 'imPlenum', name: 'Plenum', does: 'The large chamber that evens out pressure so every cylinder gets the same air.', made: 'Cast aluminum.' },
      { id: 'imInlet', name: 'Air inlet and grid heater', does: 'Where the charge air pipe connects. A grid heater warms the air for cold starts.', made: 'Aluminum; nickel-chrome heating element.' },
    ],
  },
  {
    id: 'valveCover', name: 'Valve cover', needs: [],
    does: 'Seals the top of the head over the valvetrain so oil stays in and dirt stays out. Often holds the crankcase breather and the oil fill.',
    made: 'Cast aluminum, magnesium or glass-filled nylon composite; molded rubber gasket.',
    inspect: 'Gasket hard or cracked, cover warped or cracked, breather plugged.',
    removal: 'Remove the isolator bolts and lift straight up.',
    subs: [
      { id: 'vcBody', name: 'Cover', does: 'The shell itself.', made: 'Aluminum or composite.' },
      { id: 'vcGasket', name: 'Gasket', does: 'Seals the cover to the head.', made: 'Molded silicone or nitrile rubber.' },
      { id: 'vcCap', name: 'Oil fill cap', does: 'Where oil is added.', made: 'Nylon with a rubber seal.' },
    ],
  },
  {
    id: 'fuel', name: 'Common rail, high-pressure lines and pump', needs: [],
    does: 'The gear-driven high-pressure pump raises fuel to as much as 2,500 bar (36,000 psi). The rail stores it and feeds every injector through its own line. The ECM controls rail pressure with a sensor and a metering valve.',
    made: 'Forged steel rail and pump body; cold-drawn steel tubing for lines; hardened steel pumping plungers.',
    inspect: 'Line seats and nuts (never reuse a high-pressure line), rail pressure sensor and relief valve, pump drive gear.',
    removal: 'Relieve pressure (wait after shutdown), clean around every fitting, cap each opening immediately. Dirt is the enemy of a common rail.',
    subs: [
      { id: 'fRail', name: 'Rail', does: 'A thick-walled accumulator that keeps pressure steady while injectors open and close.', made: 'Forged steel.' },
      { id: 'fLines', name: 'High-pressure lines', does: 'Carry fuel from the rail to each injector.', made: 'Seamless cold-drawn steel tubing with formed ends.' },
      { id: 'fPump', name: 'High-pressure pump', does: 'Plungers driven by the gear train pressurize the fuel.', made: 'Aluminum or iron housing, hardened steel plungers and cam.' },
    ],
  },
  {
    id: 'injectors', name: 'Fuel injectors', needs: ['valveCover', 'fuel'],
    does: 'Spray a precise dose of fuel into each cylinder at the end of compression, as fine droplets that mix with the hot air and ignite. The ECM fires them electrically, often several times per stroke (pilot, main, post).',
    made: 'Precision-ground hardened tool steel body and needle; solenoid or piezo stack; copper sealing washer.',
    inspect: 'Spray pattern and leak-back on a test bench, nozzle tip carbon or erosion, sealing washer, solenoid resistance.',
    removal: 'Unplug the harness, remove the hold-down clamp, pull with an injector puller. Keep them in cylinder order.',
    subs: [
      { id: 'injBody', name: 'Injector body and solenoid', does: 'Holds the control valve the ECM opens and closes.', made: 'Hardened steel; copper coil.' },
      { id: 'injNozzle', name: 'Nozzle tip', does: 'Seven to ten tiny holes atomize the fuel into the bowl in the piston crown.', made: 'Hardened tool steel.' },
      { id: 'injWasher', name: 'Sealing washer', does: 'Seals combustion gas from the injector bore. Replace every time.', made: 'Annealed copper.' },
    ],
  },
  {
    id: 'rockers', name: 'Rocker shaft, rockers and bridges', needs: ['valveCover'],
    does: 'Turn the camshaft lobe lift into a push on the valves. Each rocker pivots on the shaft; a roller rides the cam lobe; an adjusting screw on the other end pushes a bridge (crosshead) that opens two valves at once.',
    made: 'Ductile iron or forged steel rockers; hardened steel rollers, shaft and adjusting screws.',
    inspect: 'Rocker bushing wear on the shaft, roller flat spots, screw and bridge contact pads; then set valve lash with a feeler gauge.',
    removal: 'Back off the adjusting screws, remove the shaft bolts evenly, lift the whole shaft assembly off. Mark the bridges by cylinder.',
    subs: [
      { id: 'rShaft', name: 'Rocker shaft', does: 'The pivot all rockers swing on; drilled to carry oil to the bushings.', made: 'Hardened steel tube.' },
      { id: 'rArms', name: 'Rocker arms', does: 'One intake and one exhaust rocker per cylinder.', made: 'Ductile iron or forged steel; bronze bushing.' },
      { id: 'rRollers', name: 'Cam rollers', does: 'Roll on the lobe instead of sliding to cut friction.', made: 'Hardened bearing steel.' },
      { id: 'rBridges', name: 'Valve bridges (crossheads)', does: 'Let one rocker open two valves evenly.', made: 'Forged steel, hardened contact pads.' },
    ],
  },
  {
    id: 'camshaft', name: 'Camshaft', needs: ['rockers'],
    does: 'Opens and closes every valve at the right moment. Turns at half crankshaft speed, driven by the gear train at the rear of this engine. Lobe shape sets when a valve opens, how far, and for how long.',
    made: 'Forged or chilled cast steel; lobes induction hardened and ground.',
    inspect: 'Lobe lift and wear with a micrometer, journal size, run-out on V-blocks, gear teeth and timing mark.',
    removal: 'Line up the timing marks, remove the cam gear and the cam bearing caps (or slide it out of the head), lift straight out without nicking the lobes.',
    subs: [
      { id: 'cShaft', name: 'Shaft with lobes', does: 'Two lobes per cylinder: intake and exhaust.', made: 'Hardened steel.' },
      { id: 'cGear', name: 'Cam gear', does: 'Twice as many teeth as the crank gear, so the cam turns once every two crank turns.', made: 'Hardened steel.' },
    ],
  },
  {
    id: 'head', name: 'Cylinder head', needs: ['exhaustManifold', 'intakeManifold', 'injectors', 'camshaft', 'fuel'],
    does: 'Closes the top of the cylinders and forms the combustion chamber roof. Holds the valves, ports, injectors and camshaft, with coolant passages around the hottest areas. On this engine one head covers all six cylinders.',
    made: 'Gray cast iron or compacted graphite iron (CGI), with hardened valve seat inserts and valve guides.',
    inspect: 'Flatness with a straightedge and feeler gauge, cracks between valve seats (dye penetrant or magnaflux), valve guide wear, seat condition.',
    removal: 'Loosen the head bolts in reverse of the torque sequence, then lift with a hoist and a lifting fixture. Head bolts are usually torque-to-yield: replace them.',
    subs: [
      { id: 'hCasting', name: 'Head casting', does: 'Ports, coolant jackets, and the flat fire deck that seals to the gasket.', made: 'Gray iron or CGI.' },
      { id: 'hBolts', name: 'Head bolts', does: 'Clamp the head to the block hard enough to hold peak combustion pressure.', made: 'Alloy steel, often torque-to-yield.' },
    ],
  },
  {
    id: 'valves', name: 'Valves, springs and keepers', needs: ['head'],
    does: 'Four valves per cylinder (two intake, two exhaust) let air in and exhaust out, then seal the chamber for compression and power. Springs close them; keepers lock the spring retainers to the stems.',
    made: 'Intake: chrome-silicon or stainless steel. Exhaust: austenitic stainless (21-4N) with a hard-faced seat. Springs: chrome-silicon spring wire. Keepers: hardened steel.',
    inspect: 'Stem wear and bend, face and margin thickness, seat contact, spring free length and pressure on a spring tester.',
    removal: 'With the head on the bench, compress each spring with a valve spring compressor, pull the keepers, release, then slide the valve out. Keep them in order.',
    subs: [
      { id: 'vIntake', name: 'Intake valves', does: 'Larger heads; run cooler.', made: 'Chrome-silicon or stainless steel.' },
      { id: 'vExhaust', name: 'Exhaust valves', does: 'Run red hot; seat contact is what cools them.', made: 'Austenitic stainless with Stellite seat face.' },
      { id: 'vSprings', name: 'Springs', does: 'Close the valve and keep it following the cam.', made: 'Chrome-silicon steel wire, shot peened.' },
      { id: 'vRetainers', name: 'Retainers and keepers', does: 'Hold the spring on the stem.', made: 'Hardened steel.' },
    ],
  },
  {
    id: 'headGasket', name: 'Head gasket', needs: ['head'],
    does: 'Seals combustion pressure in each cylinder and keeps coolant and oil in their own passages between the block and the head.',
    made: 'Multi-layer steel (MLS) with embossed sealing beads and stainless fire rings around each bore; elastomer coating.',
    inspect: 'Always replaced. Read the old one: a burnt fire ring or a coolant trail shows where it leaked. Measure liner protrusion before fitting the new one.',
    removal: 'Lift off the dowels; scrape nothing that scratches the deck.',
    subs: [
      { id: 'hgBody', name: 'Gasket layers', does: 'Spring steel layers clamp and seal the joint.', made: 'Stainless spring steel, coated.' },
      { id: 'hgRings', name: 'Fire rings', does: 'Take the direct heat and pressure at each bore.', made: 'Stainless steel.' },
    ],
  },
  {
    id: 'damper', name: 'Vibration damper and pulley', needs: [],
    does: 'Every firing pulse twists the long crankshaft a little. The damper soaks up that torsional vibration before it can crack the crank. The pulley drives the belt.',
    made: 'Viscous damper: steel housing with an inertia ring floating in silicone fluid. Pulley: cast iron or stamped steel.',
    inspect: 'Dents (a dented viscous damper is scrap), leaking fluid, wobble, paint stripe across the ring shows slip on rubber dampers.',
    removal: 'Hold the crank, remove the bolts, pull it off the nose with a puller.',
    subs: [
      { id: 'dHousing', name: 'Damper housing', does: 'Sealed case filled with silicone fluid.', made: 'Steel.' },
      { id: 'dPulley', name: 'Belt pulley', does: 'Drives the fan, alternator and water pump belt.', made: 'Cast iron.' },
    ],
  },
  {
    id: 'waterPump', name: 'Water pump and thermostat housing', needs: [],
    does: 'The belt-driven impeller pushes coolant through the block, head and radiator. The thermostat stays closed until the engine is warm (about 82 °C / 180 °F) so it warms up fast, then opens to the radiator.',
    made: 'Pump: cast aluminum or iron housing, cast iron or composite impeller, sealed bearing, ceramic face seal. Thermostat: brass and steel with a wax pellet.',
    inspect: 'Weep hole seepage (seal), bearing play, impeller erosion; thermostat opening temperature in hot water.',
    removal: 'Drain the coolant, remove the belt, unbolt the pump and the thermostat housing.',
    subs: [
      { id: 'wpBody', name: 'Pump housing and impeller', does: 'Moves coolant.', made: 'Aluminum or iron.' },
      { id: 'wpStat', name: 'Thermostat', does: 'Opens as a wax pellet melts and expands.', made: 'Brass, steel, wax.' },
    ],
  },
  {
    id: 'frontCover', name: 'Front cover and crank seal', needs: ['damper', 'waterPump'],
    does: 'Closes the front of the block and holds the front crankshaft seal.',
    made: 'Cast aluminum or stamped steel; PTFE or Viton lip seal.',
    inspect: 'Seal lip wear and a groove worn in the crank nose (use a wear sleeve), cover cracks.',
    removal: 'Remove the bolts and tap it loose with a soft hammer; press the old seal out.',
    subs: [
      { id: 'fcCover', name: 'Cover', does: 'Sealing plate.', made: 'Aluminum.' },
      { id: 'fcSeal', name: 'Front crank seal', does: 'Keeps oil in around the spinning crank nose.', made: 'PTFE or fluoroelastomer lip, steel case.' },
    ],
  },
  {
    id: 'oilModule', name: 'Oil cooler and filter module', needs: [],
    does: 'Coolant flowing through the cooler takes heat out of the oil. Full-flow filters catch wear metal and dirt before oil reaches the bearings; a bypass valve protects the engine if a filter plugs.',
    made: 'Cast aluminum module; stainless or aluminum plate cooler; filters with steel cans and cellulose/synthetic media.',
    inspect: 'Oil in coolant or coolant in oil (cooler leak), filter media cut open for metal, bypass valve.',
    removal: 'Drain, spin off the filters, unbolt the module.',
    subs: [
      { id: 'omHousing', name: 'Module housing and cooler', does: 'Routes oil through the cooler and to the filters.', made: 'Cast aluminum; stacked plate cooler.' },
      { id: 'omFilters', name: 'Oil filters', does: 'Trap particles down to about 10–25 microns.', made: 'Steel can, pleated cellulose or synthetic media.' },
    ],
  },
  {
    id: 'flywheel', name: 'Flywheel', needs: [],
    does: 'Its weight smooths out the pulses between firing strokes. The ring gear is what the starter turns; the face is what the clutch grips.',
    made: 'Gray or nodular cast iron (some steel); shrink-fit hardened steel ring gear.',
    inspect: 'Heat cracks and scoring on the clutch face, ring gear teeth, run-out with a dial indicator.',
    removal: 'Install two guide studs, remove the bolts, slide it off the studs. It is heavy (about 60 kg / 130 lb): use a lifting tool.',
    subs: [
      { id: 'fwBody', name: 'Flywheel', does: 'Inertia and clutch face.', made: 'Cast iron.' },
      { id: 'fwRing', name: 'Ring gear', does: 'The starter pinion meshes here.', made: 'Hardened steel.' },
    ],
  },
  {
    id: 'flywheelHousing', name: 'Flywheel housing and rear gear train', needs: ['flywheel'],
    does: 'The housing bolts the engine to the transmission. Behind it, the rear gear train drives the camshaft, high-pressure pump, air compressor and oil pump from the crankshaft gear through idler gears.',
    made: 'Cast iron or aluminum housing; hardened steel helical gears.',
    inspect: 'Gear tooth wear and backlash, idler bushings, timing marks lined up, rear crank seal.',
    removal: 'Support it, remove the bolts, pull it off the dowels. Note the timing marks before taking gears off.',
    subs: [
      { id: 'fhHousing', name: 'Flywheel housing', does: 'SAE-standard bell that mates to the transmission.', made: 'Cast iron.' },
      { id: 'fhGears', name: 'Gear train', does: 'Crank gear, idlers and the cam gear: keeps the cam in time with the crank.', made: 'Hardened alloy steel.' },
    ],
  },
  {
    id: 'oilPan', name: 'Oil pan', needs: [],
    does: 'Holds the engine oil (about 40 L on this size of engine) and closes the bottom of the crankcase.',
    made: 'Stamped steel, cast aluminum or composite; molded gasket.',
    inspect: 'Dents that hit the pickup, cracks, drain plug threads; look at what is in the bottom (metal, sludge, coolant).',
    removal: 'Drain the oil, remove the bolts, break the seal carefully.',
    subs: [
      { id: 'opPan', name: 'Pan', does: 'Oil reservoir.', made: 'Steel, aluminum or composite.' },
      { id: 'opPlug', name: 'Drain plug', does: 'Often magnetic to catch steel particles.', made: 'Steel with a magnet.' },
    ],
  },
  {
    id: 'oilPump', name: 'Oil pump and pickup', needs: ['oilPan'],
    does: 'The gear pump draws oil through the pickup screen and pushes it to the filters, cooler, main gallery, bearings, piston cooling jets, valvetrain and turbo. A relief valve caps the pressure.',
    made: 'Cast iron or aluminum body, hardened steel gears, steel tube and wire mesh screen.',
    inspect: 'Gear-to-housing and end clearance with a feeler gauge, scoring, relief valve free, screen clean.',
    removal: 'Unbolt the pickup tube bracket and the pump.',
    subs: [
      { id: 'pBody', name: 'Pump', does: 'Two meshing gears trap oil and push it out under pressure.', made: 'Iron body, steel gears.' },
      { id: 'pPickup', name: 'Pickup tube and screen', does: 'Draws from the bottom of the sump; the screen stops big debris.', made: 'Steel tube, wire mesh.' },
    ],
  },
  {
    id: 'pistons', name: 'Pistons and connecting rods', needs: ['headGasket', 'oilPump'],
    does: 'The piston takes the combustion pressure and pushes the rod; the rod turns that straight-line push into rotation at the crankshaft. Each set comes out the top of its bore.',
    made: 'Pistons: forged steel (most modern heavy-duty) or aluminum with a steel ring insert. Rods: forged steel, fracture-split caps. Pins: case-hardened steel.',
    inspect: 'Piston skirt and ring grooves, ring end gap in the bore, pin fit, rod big-end bore roundness, bearing wear pattern.',
    removal: 'Turn each piston to bottom, remove the rod cap, push the piston and rod out the top with a wooden handle. Keep caps with their rods.',
    subs: [
      { id: 'pPiston', name: 'Piston', does: 'Crown with a combustion bowl, ring lands, pin bosses and skirt. Cooled by an oil jet from below.', made: 'Forged steel or aluminum alloy.' },
      { id: 'pRing1', name: 'Top compression ring', does: 'Seals combustion pressure. Takes the most heat.', made: 'Steel or ductile iron, chrome or plasma coated.' },
      { id: 'pRing2', name: 'Second ring', does: 'Backs up the top ring and scrapes oil down.', made: 'Cast iron.' },
      { id: 'pRing3', name: 'Oil control ring', does: 'Scrapes oil off the liner so it doesn\'t burn.', made: 'Steel rails with a spring expander.' },
      { id: 'pPin', name: 'Wrist pin and clips', does: 'Pivot between piston and rod.', made: 'Case-hardened steel; spring steel clips.' },
      { id: 'pRod', name: 'Connecting rod', does: 'Carries the push from the pin to the crank.', made: 'Forged steel (I-beam).' },
      { id: 'pCap', name: 'Rod cap and bolts', does: 'Clamps around the crank journal. Fracture-split so it fits only one way.', made: 'Forged steel; high-strength bolts.' },
      { id: 'pShells', name: 'Rod bearing shells', does: 'Ride on an oil film around the crank pin.', made: 'Steel back, copper-lead or aluminum lining, tin overlay.' },
    ],
  },
  {
    id: 'mainCaps', name: 'Main bearing caps', needs: ['oilPump', 'frontCover', 'flywheelHousing'],
    does: 'Seven caps bolt the crankshaft into the block. They are line-bored with the block, so each cap only fits in its own position and direction.',
    made: 'Nodular cast iron or forged steel; high-strength bolts.',
    inspect: 'Cap numbers and arrows, fretting on the parting faces, bolt stretch.',
    removal: 'Loosen from the center out, remove the bolts, rock the caps free. Lay them out in order.',
    subs: [
      { id: 'mcCaps', name: 'Caps', does: 'Lower half of each main bore.', made: 'Nodular iron.' },
      { id: 'mcBolts', name: 'Cap bolts', does: 'Clamp the caps to the block.', made: 'Alloy steel.' },
    ],
  },
  {
    id: 'crankshaft', name: 'Crankshaft', needs: ['mainCaps', 'pistons'],
    does: 'Turns the push of six pistons into torque at the flywheel. Throws are 120° apart so a cylinder fires every 120° of rotation (firing order 1-5-3-6-2-4). Counterweights balance the throws.',
    made: 'Forged micro-alloy or chrome-moly steel; journals induction hardened or nitrided, then ground and polished.',
    inspect: 'Journal diameter, taper and out-of-round with a micrometer; cracks (magnaflux); end play and run-out; thrust faces.',
    removal: 'Lift straight out with a sling, keeping it level. Store it standing on end or fully supported so it doesn\'t bend.',
    subs: [
      { id: 'ckMain', name: 'Main journals', does: 'Seven journals the crank spins on in the main bearings.', made: 'Hardened, ground steel.' },
      { id: 'ckPins', name: 'Rod journals (crankpins)', does: 'Offset from the center by half the stroke (81 mm here); each carries one rod.', made: 'Hardened, ground steel.' },
      { id: 'ckWeights', name: 'Counterweights', does: 'Balance the throws and rods.', made: 'Forged in one piece with the crank.' },
      { id: 'ckGear', name: 'Crank gear', does: 'Drives the rear gear train.', made: 'Hardened steel, shrink-fit.' },
    ],
  },
  {
    id: 'mainBearings', name: 'Main bearings', needs: ['crankshaft'],
    does: 'Replaceable half-shell bearings the crankshaft turns in. Pressurized oil makes a film so metal never touches metal. One position has thrust flanges to control end play.',
    made: 'Steel backing; copper-lead-tin or aluminum-tin lining; thin lead-free overlay.',
    inspect: 'Wear pattern (a story of the engine\'s life): scoring from dirt, wiped overlay from low oil, uneven wear from a bent crank or misaligned bores. Measure clearance with Plastigage.',
    removal: 'Push each upper shell out by the end opposite the locating tang.',
    subs: [
      { id: 'mbUpper', name: 'Upper shells', does: 'In the block; grooved and drilled to take oil from the gallery.', made: 'Steel-backed tri-metal.' },
      { id: 'mbThrust', name: 'Thrust washers', does: 'Stop the crank sliding front to back.', made: 'Steel-backed bronze.' },
    ],
  },
  {
    id: 'liners', name: 'Cylinder liners', needs: ['pistons'],
    does: 'Replaceable wet sleeves the pistons run in. Coolant flows directly around them; O-rings seal the bottom and the head gasket seals the top. A worn engine gets new liners instead of a rebored block.',
    made: 'Centrifugally cast alloy iron, plateau-honed cross-hatch; fluoroelastomer O-rings.',
    inspect: 'Bore wear and taper with a bore gauge, glazing, cavitation pitting on the coolant side, protrusion above the deck.',
    removal: 'Mark each liner\'s position, then pull with a liner puller.',
    subs: [
      { id: 'lSleeve', name: 'Liner', does: 'The running surface; the cross-hatch holds oil.', made: 'Centrifugally cast iron.' },
      { id: 'lSeals', name: 'O-rings', does: 'Seal coolant from the crankcase.', made: 'Viton / EPDM.' },
    ],
  },
  {
    id: 'block', name: 'Cylinder block', needs: [],
    does: 'The backbone everything bolts to: the liner bores, main bearing saddles, oil galleries, coolant jackets and mounting points. It stays on the stand.',
    made: 'Gray cast iron or compacted graphite iron (CGI): stronger and lighter than gray iron for the same job.',
    inspect: 'Deck flatness, main bore alignment, liner counterbore depth, cracks, cleaned oil galleries.',
    removal: 'Stays bolted to the engine stand.',
    subs: [
      { id: 'bCasting', name: 'Block casting', does: 'Bores, saddles, galleries and jackets in one casting.', made: 'Gray iron or CGI.' },
    ],
  },
];
