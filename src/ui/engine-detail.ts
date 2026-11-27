// In-depth write-ups for each engine component, shown when a part is picked on either 3D model or in the parts
// explorer. Written for students and new technicians, current to modern (2010+ EPA / 2017+ GHG) heavy-duty diesels:
// common rail, overhead cams, steel pistons, VGT turbos, cooled EGR, DPF/SCR, ECM control.
// Keys match the teardown part ids (teardown-data.ts); ALIAS maps the parts-explorer ids (data/engine.ts) onto them.

export const DETAIL: Record<string, { title: string; paras: string[] }> = {
  block: {
    title: 'Cylinder block',
    paras: [
      'The block is the foundation of the engine. Every other major part either sits inside it (crankshaft, pistons, liners, camshaft on older designs) or bolts to it (head, oil pan, front cover, flywheel housing, accessories). It has to hold the crankshaft perfectly straight while combustion forces of more than 20 tonnes per cylinder try to bend and twist it, carry coolant around the cylinders, and carry pressurized oil to every bearing through drilled passages called galleries.',
      'Modern heavy-duty blocks are cast from gray iron or, increasingly, compacted graphite iron (CGI). CGI has graphite particles shaped like short worms instead of flakes, which makes it about 75% stronger and stiffer than gray iron. That lets the designer use thinner walls, so a CGI block is lighter for the same strength and can take the higher peak cylinder pressures (now above 200 bar) needed for better fuel economy and lower emissions. The PACCAR MX-13 and several other current 13 L engines use CGI blocks.',
      'Inside, the upper part of the block holds the cylinder bores (or the bores for replaceable liners) surrounded by the coolant jacket. The lower part, the crankcase, is divided by bulkheads that carry the main bearing saddles. The main bearing caps, or on some engines a one-piece bedplate or ladder frame, are machined together with the block in a process called line boring, so the caps are numbered and must go back in their own position and direction.',
      'When an engine is rebuilt the block is cleaned, the galleries are brushed out, and it is checked for cracks, deck flatness, main bore alignment and size, and liner counterbore depth. Damage from freezing, overheating, or a broken rod can crack a block; cavitation (tiny vapor bubbles collapsing against the metal) can erode the coolant side of the bores if the coolant additives are neglected.',
    ],
  },
  liners: {
    title: 'Cylinder liners',
    paras: [
      'The liner, or sleeve, is the replaceable wall the piston runs against. Most heavy-duty engines use wet liners: the outside of the liner is in direct contact with coolant, sealed at the bottom by O-rings and at the top by the head gasket and a flange that sits in a counterbore in the block. Some engines use dry liners pressed into the block, or no liner at all (a parent bore machined straight into the block), which is common in light- and medium-duty engines.',
      'Liners are centrifugally cast from alloy iron and finished with a plateau hone: a cross-hatch of fine grooves with the peaks knocked off. The grooves hold a thin film of oil for the rings to ride on; the flat plateaus give a large bearing area so the rings seal quickly and wear slowly. A liner that has lost its cross-hatch and turned shiny is called glazed and lets oil past the rings.',
      'The top of the liner must stand a specific amount above the block deck, usually a few hundredths of a millimeter, called protrusion. That height is what clamps the head gasket fire ring tight around each cylinder. Protrusion is measured with a dial indicator at several points on every liner before the head goes on; too little or uneven protrusion is a common cause of head gasket failure.',
      'The outside of a wet liner vibrates as the piston slaps from side to side. If the coolant lacks the right additives (nitrite or organic acid inhibitors), the vibration creates and collapses tiny vapor bubbles that eat pits into the liner wall. This cavitation erosion can eventually go all the way through and let coolant into the oil, which is why coolant testing is part of every service.',
    ],
  },
  pistons: {
    title: 'Pistons',
    paras: [
      'The piston is the moving wall of the combustion chamber. It seals the cylinder with its rings, takes the full force of combustion on its crown, and passes that force through the wrist pin to the connecting rod. A modern heavy-duty piston sees peak pressures above 200 bar (3,000 psi) and crown temperatures of 400–500 °C, while changing direction twice every revolution.',
      'Since about 2007 most heavy-duty engines have switched from aluminum or two-piece articulated pistons to one-piece forged steel pistons (for example Mahle Monotherm style). Steel is heavier but much stronger at high temperature, so the piston can be shorter, the top ring can sit higher (less unburned gas trapped above it, which helps emissions), and it survives the higher cylinder pressures used to meet fuel economy rules. A gallery cast inside the crown is filled with oil from a piston cooling jet in the block on every stroke; without that oil spray the crown would melt.',
      'The top of the piston has a shaped bowl, the combustion chamber. The injector sprays fuel into the bowl, and its shape creates swirl and squish that mix the fuel with the air. Below the crown are the ring grooves (lands), the pin bosses that carry the wrist pin, and the skirt, which guides the piston straight in the bore and is often coated to cut friction.',
      'When inspecting a piston, look at the crown for cracks or erosion (a sign of a dribbling injector), the ring lands for cracks, the grooves for wear, and the skirt for scuffing that would point to overheating or poor lubrication. A cracked or holed piston usually shows up first as heavy blow-by out of the crankcase breather and a misfire on that cylinder.',
    ],
  },
  rings: {
    title: 'Piston rings',
    paras: [
      'A diesel piston carries three rings. The top compression ring seals the combustion pressure; gas pressure actually gets behind the ring and pushes it harder against the liner, so it seals better the harder the engine works. The second ring backs up the top ring and also scrapes oil down. The bottom ring is the oil control ring: two thin rails or a slotted ring pushed outward by a spring expander, which leaves only a microscopically thin oil film on the liner.',
      'Top rings on heavy-duty engines are usually steel or ductile iron with a hard face coating such as chrome-ceramic or plasma-sprayed molybdenum, and many are keystone (tapered) shaped so their movement in the groove breaks up carbon. The ring must have a small gap at its ends so it can expand when hot; the gap is checked by putting the ring in the bore and measuring with a feeler gauge.',
      'Worn rings let combustion gas down into the crankcase (blow-by) and let oil up into the combustion chamber. Symptoms are low but even compression on all cylinders that rises when a little oil is squirted in (a wet compression test), heavy breather flow, high oil consumption, and blue smoke. Oil analysis showing rising iron and chrome points the same way.',
    ],
  },
  rod: {
    title: 'Connecting rods',
    paras: [
      'The connecting rod links the piston to the crankshaft and turns the piston\'s straight-line motion into rotation. The small end holds the wrist pin in a bronze bushing; the big end wraps around the crankpin with a pair of bearing shells. The rod is alternately pushed hard in compression during the power stroke and pulled in tension at the top of the exhaust stroke, millions of times per hour.',
      'Rods are forged steel, usually an I-beam section for stiffness at low weight, and many are drilled down the center to carry oil from the crankpin to the small end and piston. Most modern rods are fracture-split: the big end is forged in one piece and then cracked apart along a laser-scored line. The rough fractured faces fit back together in only one way, which locates the cap exactly without dowels.',
      'At rebuild the big-end bore is measured for size and roundness, the rod is checked for bend and twist on a fixture, and the rod bolts are usually replaced because they are stretched (torque-to-yield) when installed. A spun rod bearing, where the shell has welded to the crank and rotated in the rod, usually ruins both the rod and the crankshaft journal.',
    ],
  },
  crankshaft: {
    title: 'Crankshaft',
    paras: [
      'The crankshaft turns the up-and-down push of the pistons into the rotation that drives the truck. Each cylinder has a crankpin offset from the shaft center by half the stroke; on this engine that offset is 81 mm. On an inline six the throws are arranged in three pairs 120° apart (1 and 6, 2 and 5, 3 and 4), so one cylinder fires every 120° of rotation and the engine is naturally balanced without balance shafts.',
      'Heavy-duty crankshafts are forged from medium-carbon micro-alloy or chrome-molybdenum steel. The journals are induction hardened or nitrided, then ground and polished to a mirror finish so they can run on a film of oil only a few thousandths of a millimeter thick. Oil enters through drillings in the main journals and is carried through the crank webs to the rod journals.',
      'Counterweights opposite each throw balance the weight of the throw and part of the rod and piston. A vibration damper on the front and the flywheel on the back control twisting (torsional) vibration. The rear of the crank carries the gear that drives the gear train, and one main bearing has thrust surfaces that hold the crank from sliding forward and back; that movement is called end play.',
      'When inspecting a crankshaft, measure every journal with a micrometer at several points to find wear, taper and out-of-round, check run-out on V-blocks with a dial indicator, and check for cracks with magnetic particle inspection, especially at the fillets where the journals meet the webs. Low oil pressure, a knock under load, and copper and lead in the oil analysis usually mean the bearings and journals are wearing.',
    ],
  },
  mainBearings: {
    title: 'Main and rod bearings',
    paras: [
      'Engine bearings are plain bearings: thin steel half-shells lined with a softer bearing material. They do not have balls or rollers. When the engine runs, oil pumped into the narrow gap between the shell and the journal is dragged around by the spinning shaft and forms a wedge of pressurized oil (a hydrodynamic film) that lifts the shaft so metal never touches metal.',
      'A modern heavy-duty shell has a steel back for strength, a lining of copper-lead-tin or aluminum-tin, and a very thin overlay (often lead-free polymer or tin-based). The overlay is soft so dirt particles can embed into it instead of scoring the crank. Upper shells are grooved and drilled to take oil from the gallery; the shells are slightly larger than the bore (crush) so they lock in place when the cap is torqued.',
      'Bearings are the record of an engine\'s life. Scratches and embedded particles mean dirty oil or a bypassed filter; overlay wiped off evenly across all bearings means low oil pressure or thin, fuel-diluted oil; wear only on one edge points to a bent rod or misaligned bores; a bright band with heat discoloration means the oil film broke down. Clearance is checked with Plastigage or by measuring the bore and journal with micrometers.',
    ],
  },
  mainCaps: {
    title: 'Main bearing caps',
    paras: [
      'The main bearing caps hold the crankshaft into the block. Each one forms the lower half of a main bearing bore. Because the caps are machined together with the block (line bored), each cap is stamped with its position and an arrow pointing to the front, and must never be swapped or turned around.',
      'Caps are made of nodular (ductile) iron or forged steel. Some engines replace the individual caps with a one-piece bedplate or ladder frame that ties all the caps together and stiffens the lower block, which reduces noise and vibration. Cap bolts are tightened in a specified sequence, often by torque plus a set angle.',
      'When removing caps, check the numbers and arrows first, then loosen from the center outward. Inspect the parting faces for fretting (dull, polished marks that show the cap has been moving), which means the bolts lost clamp load, and check the bolt threads in the block.',
    ],
  },
  flywheel: {
    title: 'Flywheel',
    paras: [
      'A diesel produces torque in pulses, one power stroke every 120° on a six-cylinder. The flywheel\'s weight stores energy during each power stroke and gives it back between them, so the crankshaft turns smoothly, especially at idle. On a manual or automated manual transmission, the flywheel face is also the friction surface the clutch disc clamps against.',
      'Heavy-duty flywheels are cast iron and weigh 50–80 kg (110–175 lb). A steel ring gear is heated and shrunk onto the outside; the starter pinion meshes with it to crank the engine. Many flywheels also carry a target wheel of teeth or holes that the crankshaft position sensor reads, so the ECM knows exactly where each piston is.',
      'Inspect the clutch face for heat cracks, hard spots and scoring; it can usually be resurfaced within limits. Check the ring gear for chipped or worn teeth (worn in a few spots means the engine always stops in the same places), and check face and bore run-out with a dial indicator after installation.',
    ],
  },
  flywheelHousing: {
    title: 'Flywheel housing and rear gear train',
    paras: [
      'The flywheel housing is the bell that surrounds the flywheel and bolts the engine to the transmission. Its size is set by SAE standards (an SAE 1 housing is common on heavy trucks) so engines and transmissions from different makers fit together. It also carries the starter and the rear engine mounts on many trucks.',
      'Most current heavy-duty engines put the timing gear train at the rear, behind or inside the flywheel housing, where the crankshaft is calmest (the front of the crank twists more). A gear on the crank drives the camshaft through one or more idler gears, along with the high-pressure fuel pump, air compressor, power steering pump and often the oil pump. The cam gear has twice as many teeth as the crank gear, so the cam turns once for every two crank revolutions.',
      'The gears are hardened helical steel gears. Each gear meshes with marked teeth that must line up when the gear train is assembled, or the valve and injection timing will be wrong (an ECM will usually set a cam/crank correlation code). Inspect tooth wear and pitting, idler bushing wear, and backlash between gears with a dial indicator.',
    ],
  },
  damper: {
    title: 'Vibration damper',
    paras: [
      'Every power stroke twists the crankshaft slightly, and the long crank of an inline six springs back like a torsion bar. At certain engine speeds these twists line up with the crank\'s natural frequency and grow large enough to crack the crankshaft or break gear teeth. The vibration damper on the front of the crank absorbs that torsional vibration.',
      'Heavy-duty engines use viscous dampers: a sealed steel housing bolted to the crank, with a heavy inertia ring floating inside in thick silicone fluid. The housing twists with the crank; the ring wants to turn smoothly; the fluid shears between them and turns the vibration into heat. Lighter engines use a rubber damper, an outer ring bonded to the hub with rubber.',
      'A viscous damper with a dent, a bulge or any fluid leak must be replaced, because the inner ring may be jammed. Many makers specify replacement at overhaul or after a set number of miles. Dampers get hot in service; a damper that runs much hotter than normal is working too hard or failing. Never pry against a viscous damper.',
    ],
  },
  frontCover: {
    title: 'Front cover and crankshaft seal',
    paras: [
      'With the gear train at the back, the front cover on most modern heavy-duty engines is a simple sealing plate. It closes the front of the crankcase and holds the front crankshaft seal, and it often carries the water pump, oil fill or accessory drive brackets.',
      'Modern crank seals are usually PTFE (Teflon) lip seals, which run with very little friction, or fluoroelastomer (Viton) lip seals with a steel case. PTFE seals must be installed dry with the special tool provided and the engine must not be turned for a while after installation so the lip can form to the shaft.',
      'If the seal has worn a groove in the crankshaft nose, a thin steel wear sleeve is pressed over the nose to give the new seal a fresh surface. A leaking front seal can also be caused by high crankcase pressure from blow-by, so check the breather before blaming the seal.',
    ],
  },
  head: {
    title: 'Cylinder head',
    paras: [
      'The cylinder head closes the top of each cylinder and forms the roof of the combustion chamber. It contains the intake and exhaust ports, the valves and their seats and guides, the injector bores, coolant passages around the hottest areas between the valves, and on modern overhead-cam engines the camshaft and rocker shaft. It also has to stay flat and sealed against more than 200 bar of combustion pressure.',
      'Heavy-duty heads are cast from gray iron or compacted graphite iron. Most current 11–15 L engines use a one-piece head over all six cylinders, which is stiffer and keeps the camshaft in line; some designs use one head per cylinder or per pair of cylinders, which are cheaper to replace individually. Valve seats are hardened steel inserts pressed into the head, and valve guides are pressed-in iron or bronze sleeves.',
      'The head is clamped to the block by head bolts tightened in a spiral sequence from the center outward, typically in several steps finishing with a set angle. Many are torque-to-yield and must be replaced. Before reuse, the head is pressure tested for cracks (commonly between valve seats or around the injector bore), and the fire deck is checked for flatness with a straightedge and feeler gauge.',
      'A cracked head or a leaking injector sleeve lets combustion gas into the coolant (bubbles in the surge tank, overheating under load) or coolant into the cylinder (white smoke, coolant loss with no leak). A pressure test of the cooling system and a combustion gas (block) test help find it.',
    ],
  },
  headGasket: {
    title: 'Head gasket',
    paras: [
      'The head gasket seals three things at once: combustion pressure inside each cylinder, coolant passing between the block and head, and oil passages feeding the valvetrain. It has to do this while the head and block expand at different rates and the clamping force changes with every firing pulse.',
      'Modern heavy-duty gaskets are multi-layer steel (MLS): several thin layers of spring stainless steel with raised beads that act like springs, coated with a thin elastomer for micro-sealing. A steel fire ring around each bore takes the direct heat. On engines with wet liners, the liner protrusion sets how tightly the fire ring is clamped, so liner height is checked before the gasket goes on.',
      'Head gaskets are never reused. When one fails, read it: a burnt section of fire ring points to the cylinder that leaked; a coolant track across a land shows where coolant crossed. Then find the cause, usually overheating, low or uneven liner protrusion, a warped head, stretched bolts, or a dribbling injector.',
    ],
  },
  valves: {
    title: 'Valves, springs and keepers',
    paras: [
      'Heavy-duty diesels use four valves per cylinder: two intake and two exhaust. Four smaller valves give more flow area than two large ones, and leave room for the injector to sit straight up in the center of the cylinder so the fuel spray is even. The valves are poppet valves: a stem that slides in a guide and a head with an angled face that seals against a hardened seat in the head.',
      'Intake valves run relatively cool and are made from chrome-silicon or stainless steel. Exhaust valves run red hot (700 °C or more), so they are made from heat-resistant austenitic stainless steel and often have a hard-facing alloy such as Stellite welded onto the seat face. A valve cools mainly through contact with its seat, so a valve that does not close fully (lash too tight, carbon on the seat) quickly burns.',
      'Valve springs, made from shot-peened chrome-silicon wire, close the valve and keep it following the cam at high speed. A retainer and split keepers (collets) lock the spring onto the stem. Stem seals keep oil from running down the guide into the cylinder.',
      'At inspection, measure stem diameter and guide clearance, check the face and margin (the thickness of the edge), the seat contact pattern, and valve recession or protrusion below the head deck. Springs are checked for free length and the load at a set height on a spring tester. A burnt exhaust valve leaks during compression: low compression on one cylinder, air from the tailpipe on a leak-down test, and a misfire code the ECM may blame on the injector.',
    ],
  },
  camshaft: {
    title: 'Camshaft',
    paras: [
      'The camshaft opens each valve at exactly the right moment, holds it open for the right length of time, and lets it close. Each lobe is a carefully ground profile: the base circle is where the valve is closed, and the ramp and nose decide when the valve opens, how fast, how far, and for how long. On a four-stroke engine the camshaft turns at half crankshaft speed because each valve opens once every two revolutions.',
      'Most current 13–15 L engines use an overhead camshaft in the head driven from the rear gear train. That eliminates the pushrods and lifters of older in-block cam designs, which lets the valves follow the cam more precisely at high pressure and allows stiffer valvetrains for engine braking. Some engines have one overhead cam; others, such as the Detroit DD15, use two.',
      'Camshafts are forged or chilled cast steel, with the lobes induction hardened and ground. Many engines also have extra lobes for the compression-release engine brake, and older electronic unit injector engines had a third lobe per cylinder to pump the injector. On common rail engines the injectors are fed from the rail and need no cam lobe.',
      'A worn lobe gives less lift: the valve opens late and not as far, the cylinder breathes poorly, and the engine runs rough with no fault code. Lobe height is measured with a micrometer, and journal wear and run-out are checked. When the cam is reinstalled, the timing marks on the cam gear and the crank gear must line up.',
    ],
  },
  rockers: {
    title: 'Rocker arms, shaft and bridges',
    paras: [
      'Rocker arms transfer the cam lobe\'s lift to the valves. Each rocker pivots on a hollow rocker shaft that also carries oil to the rocker bushings. On an overhead-cam engine a roller on one end of the rocker rides on the cam lobe; the other end has an adjusting screw that presses on a valve bridge (crosshead), which opens a pair of valves together.',
      'Rockers are ductile iron or forged steel, with hardened steel rollers running on needle bearings to reduce friction. The adjusting screw sets valve lash: a small clearance, checked with a feeler gauge when the valve is fully closed, that makes sure the valve can close completely when parts expand with heat. Typical heavy-duty settings are around 0.3–0.5 mm intake and 0.6–0.8 mm exhaust; always use the engine maker\'s figure.',
      'Most heavy-duty engines also have a compression-release engine brake (often called a Jake brake after the Jacobs brand), built into the rocker arms or a separate housing on top. When the driver turns it on, a hydraulic piston opens the exhaust valves near the top of the compression stroke, releasing the compressed air before it can push the piston back down. The engine then absorbs power instead of making it, helping hold the truck on a grade.',
      'Too little lash holds a valve slightly open, burning it and lowering compression. Too much lash causes a ticking noise, less valve lift and faster wear. Lash is checked at overhaul and at intervals set by the maker, cylinder by cylinder in firing order using the timing marks.',
    ],
  },
  valveCover: {
    title: 'Valve cover',
    paras: [
      'The valve cover (rocker cover) seals the top of the cylinder head over the camshaft and valvetrain. It keeps oil splashed by the rockers inside and keeps dirt and water out. On many modern engines the injector wiring and the engine brake wiring pass through it, and it may contain the crankcase breather or oil separator.',
      'Covers are made from cast aluminum, magnesium, or glass-filled nylon composite, usually mounted on rubber isolators so engine vibration does not make it ring like a speaker. The gasket is a molded silicone or nitrile rubber seal that fits in a groove. Composite covers can crack if bolts are over-torqued.',
      'Removing the valve cover is the first step for setting valve lash, servicing injectors, or checking the camshaft and rockers. Look for sludge (overdue oil changes or coolant contamination) and for a milky film (coolant or condensation).',
    ],
  },
  fuel: {
    title: 'Common rail fuel system',
    paras: [
      'Every modern on-highway diesel uses high-pressure common rail injection or something similar. A gear-driven high-pressure pump raises fuel to as much as 2,500–2,700 bar (36,000–39,000 psi) and stores it in a thick-walled rail. Every injector is connected to the rail, so full injection pressure is available at any engine speed. The ECM controls rail pressure with a pressure sensor on the rail and a metering valve on the pump inlet.',
      'Before the high-pressure pump, a low-pressure system lifts fuel from the tank: a transfer (lift) pump, a fuel-water separator and a primary filter, then a fine secondary filter (2–5 microns) to protect the injectors. Injectors return a little fuel to the tank, which also cools them. Some systems, like Cummins XPI or the Detroit amplified common rail, add their own variations, but the principle is the same.',
      'Because injection pressure no longer depends on engine speed, the ECM can make several injections per cycle: a small pilot injection to start combustion gently (quieter, less NOx), the main injection, and post injections that help burn soot or raise exhaust temperature for DPF regeneration. This flexibility is a big part of how modern engines meet emissions limits.',
      'Cleanliness is critical: a speck of dirt can ruin an injector. Clean around every fitting before opening it and cap every opening at once. High-pressure lines are formed steel tubes that seal by metal-to-metal contact and must not be reused once loosened on many engines. Never check for leaks with your hand; a fine spray of fuel at rail pressure can penetrate skin and cause a serious injury.',
    ],
  },
  injectors: {
    title: 'Fuel injectors',
    paras: [
      'The injector sprays a precisely measured amount of fuel into the combustion chamber at the end of the compression stroke. It sits upright in the center of the four valves with its tip in the middle of the piston bowl. The nozzle has seven to ten tiny holes, each smaller than a tenth of a millimeter, that break the fuel into a fine mist that mixes with the hot air and ignites.',
      'A common rail injector is a hydraulic valve opened by an electrical signal from the ECM. A fast solenoid or piezoelectric actuator moves a control valve, which changes the pressure balance on the nozzle needle and lets it lift. The ECM decides when each injection starts and how long it lasts, often several times per cycle. Injectors come with trim codes (IQA or calibration codes) that are programmed into the ECM so it can correct for each injector\'s small differences.',
      'Injectors are made from hardened, precision-ground tool steel with clearances measured in microns. A copper sealing washer seals the tip to the head, and in many heads the injector sits in a thin copper or stainless sleeve with coolant on the outside.',
      'Common injector faults are a worn or eroded nozzle (poor spray, smoke), a sticking needle (dribbling fuel, a burnt piston crown), internal leakage (high return flow, low rail pressure) and electrical faults in the solenoid or wiring. The ECM watches each cylinder\'s contribution to crankshaft speed and can set a cylinder balance code, but always check compression and valve lash before replacing an injector.',
    ],
  },
  intakeManifold: {
    title: 'Intake manifold and charge air system',
    paras: [
      'The intake system delivers clean, cool, compressed air to every cylinder. Air passes through the air cleaner, into the turbo compressor, then through the charge air cooler (an air-to-air radiator in front of the engine radiator), and finally into the intake manifold, which distributes it to the six intake ports.',
      'Cooling the charge air after the turbo is important: compressing air heats it to 150–200 °C, and hot air is thin air. The charge air cooler brings it down to roughly 40–50 °C, packing more oxygen into each cylinder, which allows more fuel to burn cleanly and lowers combustion temperatures and NOx. On EGR engines, cooled exhaust gas is mixed into the intake air at or near the manifold.',
      'The manifold is usually cast aluminum or composite plastic, and carries the intake manifold pressure and temperature sensor (boost sensor) and often a grid heater, an electric element that warms the intake air for cold starts in place of glow plugs. Air filter restriction is checked with a gauge or the restriction indicator; most heavy-duty engines allow about 25 inches of water before the filter must be changed.',
      'Leaks in the charge air system (a split boot or loose clamp) cause low boost, low power and black smoke, and can set a low boost code. A charge air cooler leak test, pressurizing the system to about 30 psi and watching it bleed down, finds them. Oil in the boots usually points to turbo seals or high crankcase pressure.',
    ],
  },
  exhaustManifold: {
    title: 'Exhaust manifold',
    paras: [
      'The exhaust manifold collects the exhaust from each cylinder and delivers it to the turbocharger. On an inline six it is often split so cylinders 1–3 and 4–6 feed separate passages into a divided turbine housing. This keeps the strong exhaust pulses from interfering with each other and uses their energy to spin the turbo faster at low speed (pulse turbocharging).',
      'Exhaust manifolds run at 600–700 °C, so they are made from high-silicon-molybdenum ductile iron or cast stainless steel. Because a long hot manifold grows several millimeters, it is built in sections joined by slip joints that let it expand without cracking, and held to the head with heat-resistant studs and spacers.',
      'Inspect for cracks between ports, warped flanges, worn slip joints and broken studs. A leak shows up as black soot tracks, a ticking noise that is loudest under load, lower boost, and on EGR engines it can upset the EGR flow calculation.',
    ],
  },
  turbo: {
    title: 'Turbocharger',
    paras: [
      'The turbocharger uses energy in the exhaust that would otherwise go out the stack. Exhaust gas spins a turbine wheel; a compressor wheel on the same shaft packs air into the intake at up to 3 bar or more above atmospheric pressure (40+ psi of boost). More air in the cylinders means more fuel can be burned cleanly, so a turbocharged engine makes far more power from the same displacement. Shaft speeds exceed 100,000 rpm.',
      'Most current heavy-duty engines use a variable geometry turbocharger (VGT). Movable vanes or a sliding nozzle ring in the turbine housing change how the exhaust hits the turbine. Closing them gives fast boost at low engine speed; opening them prevents overspeeding at high speed. The ECM also uses the VGT to create back-pressure that drives exhaust gas through the EGR system, and to raise exhaust temperature for DPF regeneration. Other designs use a wastegate, two turbos in series, or turbocompounding.',
      'The turbine wheel is a nickel superalloy that survives exhaust temperatures over 700 °C; the compressor wheel is aluminum. The shaft rides in bronze journal bearings fed with engine oil; seals at each end keep oil out of the air and exhaust. Many turbos are also water-cooled. Oil supply is critical: always let a hot engine idle a few minutes before shutdown so the turbo is not left without oil while it is still spinning and red hot.',
      'Common failures are oil seal leaks (oil in the charge air boots, blue smoke), bearing wear (whine, wheels rubbing the housing), foreign object damage to the compressor wheel from a torn air filter, and sticking VGT vanes from soot (low or high boost codes). Inspect shaft end play and radial play with a dial indicator and check VGT actuator travel with the scan tool.',
    ],
  },
  egr: {
    title: 'EGR system (exhaust gas recirculation)',
    paras: [
      'Nitrogen oxides (NOx) form when nitrogen and oxygen in the air are exposed to the very high flame temperatures in a diesel cylinder. The EGR system lowers those temperatures by routing a measured amount of exhaust gas back into the intake. Exhaust has already burned its oxygen, so it takes up space and absorbs heat without feeding the fire; peak flame temperature drops and so does NOx formation, by half or more.',
      'Exhaust is taken from the exhaust manifold before the turbo and passed through the EGR cooler, a stainless steel heat exchanger with engine coolant flowing around its tubes, which cools the gas from about 600 °C to 150 °C or less. An ECM-controlled EGR valve then meters it into the intake. On most engines the VGT is partly closed to make exhaust pressure higher than boost pressure so the gas flows the right way. The ECM calculates EGR flow from a differential pressure sensor or a venturi and temperature sensors.',
      'EGR adds soot and acids to the engine oil and heat to the cooling system, which is why modern engines need CK-4 or FA-4 oil and bigger radiators. The most common EGR problems are a cooler that plugs with soot (low EGR flow, high NOx, codes), a cooler that cracks inside (coolant loss into the exhaust, white smoke, sometimes coolant in the intake), and a sticking EGR valve.',
      'Since 2010, most engines combine cooled EGR with SCR (selective catalytic reduction) in the exhaust, which removes most of the remaining NOx with DEF. A few makers chose SCR-only designs with little or no EGR, but EGR remains on most current North American heavy-duty engines.',
    ],
  },
  ecm: {
    title: 'Engine control module (ECM)',
    paras: [
      'The ECM is the computer that runs a modern diesel. It reads dozens of sensors (crank and cam position, boost, intake and coolant temperature, oil pressure, rail pressure, accelerator position, EGR flow, NOx sensors and more), decides how much fuel to inject, when and in how many shots, and controls the rail pressure, VGT, EGR valve, engine brake, cooling fan and aftertreatment.',
      'The ECM is also the governor. Older mechanical engines used flyweight governors to hold speed against changing loads; today the ECM compares actual engine speed (from the crank sensor) with the speed or torque requested by the driver, cruise control or the transmission, and adjusts fuel many times per second. It limits top engine speed and road speed, smoke at low boost, and torque to protect the drivetrain.',
      'It also protects the engine. If oil pressure drops, coolant temperature or level goes out of range, or the aftertreatment is overloaded, the ECM turns on a warning lamp, logs a fault code (SPN and FMI on J1939), and can reduce power (derate) or shut the engine down. The ECM shares data with the transmission, ABS, cluster and other modules over the J1939 CAN network, the same network you can watch on the CAN network page.',
      'The ECM is usually mounted on the side of the block on rubber isolators and is often cooled by fuel flowing through a cold plate. Before replacing one, check its power and ground circuits and connectors: most "bad ECM" complaints are wiring problems.',
    ],
  },
  waterPump: {
    title: 'Water pump and thermostat',
    paras: [
      'The water pump is a centrifugal pump driven by the accessory belt or a gear. Its impeller throws coolant outward and pushes it through the oil cooler, the block around the liners, up through the head, and out to the radiator, often more than 400 L (100 gal) per minute at rated speed. A ceramic and carbon face seal keeps coolant away from the shaft bearing; a weep hole lets a small amount of seepage escape so it does not reach the bearing.',
      'The thermostat controls engine temperature. A wax pellet inside melts and expands as the coolant warms, opening the valve at about 82 °C (180 °F) on most heavy-duty engines and fully open about 10 °C higher. Until then coolant bypasses the radiator and returns to the pump, so the engine warms up quickly. Heavy-duty engines often have two thermostats side by side.',
      'A thermostat stuck open causes slow warm-up, poor heater output and a coolant temperature that never reaches normal, which can set a code and increase wear and fuel use. One stuck closed causes overheating. Thermostats can be tested in hot water with a thermometer. A water pump is replaced if it leaks steadily from the weep hole, the bearing is rough or loose, or the impeller is eroded.',
    ],
  },
  cooling: {
    title: 'Cooling system and coolant passages',
    paras: [
      'About a quarter to a third of the energy in the fuel leaves as heat into the coolant and oil. The cooling system carries it away: coolant flows through passages cast into the block around each liner and through the head around the valve seats and injector, then to the radiator, where the cooling fan and ram air remove the heat. The system also heats the cab and, on EGR engines, cools the exhaust gas.',
      'Coolant is a mixture of water and ethylene or propylene glycol (usually 50/50) plus corrosion inhibitors. Most new heavy-duty engines use extended life coolant (ELC) with organic acid inhibitors that last 600,000 miles or more with occasional extender; older fully formulated coolants needed regular additive checks. Coolant is tested with a refractometer for freeze protection and with test strips for inhibitor level.',
      'The system is pressurized by the surge tank cap to raise the boiling point, typically 7–15 psi. A pressure test finds external leaks; combustion gas in the coolant (bubbles, a positive block test) points to a head gasket, a cracked head or an injector sleeve. Low coolant level, a stuck thermostat, a slipping fan clutch or a plugged radiator all lead to high coolant temperature, which the ECM will warn about and eventually derate or shut down for.',
    ],
  },
  oilModule: {
    title: 'Oil cooler and filters',
    paras: [
      'Engine oil picks up heat from the pistons, bearings and turbo, so it is cooled before it goes back to them. In the oil cooler, oil flows through a stack of plates or tubes with engine coolant on the other side; this also warms the oil quickly in cold weather. The module usually also holds the oil filters, the oil pressure regulator, and a filter bypass valve.',
      'Full-flow filters clean all the oil going to the engine, typically down to 10–25 microns. Many engines add a bypass (partial-flow) filter that cleans a small portion of the oil much finer. If a filter plugs or the oil is very thick on a cold start, the bypass valve opens so the engine gets dirty oil instead of no oil at all.',
      'An internal cooler leak mixes oil and coolant: milky oil, or oil floating in the surge tank. When changing filters, cut the old element open and look for metal; take an oil sample for analysis at every service. Oil analysis shows wear metals (iron, chrome, copper, lead, aluminum), coolant (sodium, potassium, glycol), fuel dilution and soot.',
    ],
  },
  oilPan: {
    title: 'Oil pan',
    paras: [
      'The oil pan closes the bottom of the crankcase and holds the engine oil, about 40 L (10–11 gal) on a 13 L engine. The deep sump section sits under the oil pump pickup so the pump always has oil, even on a grade or while braking. Baffles keep oil from sloshing away from the pickup.',
      'Pans are stamped steel, cast aluminum or, increasingly, composite plastic, which is lighter and quieter. They seal with a molded rubber gasket and have a drain plug, often magnetic, and the dipstick tube or oil level sensor.',
      'Read the dipstick at every inspection: oil that is rising between changes and smells of diesel means fuel dilution (often a leaking injector or too many regenerations); milky oil means coolant. When the pan is off at overhaul, what is lying in the bottom (metal flakes, bearing material, sludge) tells you a lot about what happened inside.',
    ],
  },
  oilPump: {
    title: 'Oil pump and pickup',
    paras: [
      'The oil pump is the heart of the lubrication system. It draws oil from the sump through the pickup tube and screen, then pushes it through the cooler and filters into the main oil gallery, which feeds the main bearings, rod bearings (through the crank), camshaft and rocker shafts, the piston cooling jets, the turbo, the air compressor and the high-pressure fuel pump drive.',
      'Most heavy-duty pumps are gear pumps driven from the gear train: two meshing gears trap oil between their teeth and the housing and carry it to the outlet. Because they move a fixed volume per turn, a relief valve opens to limit pressure at high speed or with cold oil. Some newer engines use variable-displacement pumps that reduce flow when less is needed, saving fuel.',
      'Typical heavy-duty oil pressure is around 15–20 psi minimum at hot idle and 35–60 psi at rated speed. Low pressure everywhere points to low oil level, a plugged pickup screen, a stuck relief valve, a worn pump, or worn bearings letting too much oil escape. Always confirm a low oil pressure reading with a mechanical master gauge before condemning the sensor or the engine.',
    ],
  },
};

/** Parts-explorer and MX-13 label ids that share a write-up with a teardown part. */
export const ALIAS: Record<string, string> = {
  rocker: 'rockers', injector: 'injectors', commonRail: 'fuel', waterJacket: 'cooling', liner: 'liners', piston: 'pistons',
  // teardown sub-parts that deserve the full write-up
  pRing1: 'rings', pRing2: 'rings', pRing3: 'rings', pRod: 'rod', pCap: 'rod', pShells: 'mainBearings', vIntake: 'valves',
  vExhaust: 'valves', fRail: 'fuel', injBody: 'injectors', omFilters: 'oilModule', wpStat: 'waterPump',
};
export function detailFor(id: string | null | undefined) {
  if (!id) return null;
  return DETAIL[id] ?? DETAIL[ALIAS[id]] ?? null;
}
export function detailHTML(id: string | null | undefined, esc: (s: string) => string) {
  const d = detailFor(id);
  return d ? d.paras.map((p) => `<p>${esc(p)}</p>`).join('') : '';
}
