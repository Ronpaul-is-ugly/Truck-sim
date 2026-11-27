// Diesel engine systems, written to the depth of a classic diesel fundamentals handbook but current to modern
// heavy-duty on-highway engines (common rail, VGT, cooled EGR, DPF + SCR, ECM control). Same list/body layout as the
// physics section, so the two read as one course.

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

interface Sys {
  id: string;
  title: string;
  lead: string;
  paras: string[];
  /** Key facts shown as a small table under the text. */
  facts?: [string, string][];
  /** Then and now: how older engines did it versus how current engines do it. */
  then?: [string, string];
}

const SYSTEMS: Sys[] = [
  {
    id: 'diesel',
    title: 'Diesel vs gasoline',
    lead: 'A diesel engine has no spark plugs. It squeezes air so hard that the air gets hot enough to ignite fuel the instant it is sprayed in. That is called compression ignition.',
    paras: [
      'A gasoline engine mixes fuel and air before compression and lights the mixture with a spark. It controls power by throttling the air, which wastes energy, and it cannot use high compression or the mixture would ignite on its own (knock). A diesel draws in air only, with no throttle, compresses it at a ratio of roughly 15–18:1, which heats it to 500–700 °C, and then injects fuel. Power is controlled by how much fuel is injected, not by restricting air.',
      'High compression and no throttle are why diesels are efficient. A modern heavy-duty diesel turns about 45–47% of the energy in its fuel into work at the crankshaft at its best operating point, against roughly 30–35% for a typical gasoline engine. Diesel fuel also carries about 12–15% more energy per gallon than gasoline.',
      'The price is weight and strength: peak cylinder pressures above 200 bar need heavy blocks, heads, crankshafts and pistons. Because a diesel always runs with excess air, it makes little carbon monoxide, but the hot, oxygen-rich flame makes nitrogen oxides (NOx) and the fuel-rich edges of each spray make soot. Controlling those two is the reason for EGR, the DPF and SCR.',
    ],
    facts: [['Compression ratio', '15–18:1 (heavy-duty)'], ['Air temperature at end of compression', '500–700 °C'], ['Diesel fuel autoignition', 'about 210–250 °C'], ['Peak brake thermal efficiency', 'about 45–47% (best current engines)']],
  },
  {
    id: 'strokes',
    title: 'Two-stroke and four-stroke',
    lead: 'Every engine must take in air, compress it, burn fuel and push out exhaust. A four-stroke engine does this in two crank revolutions; a two-stroke does it in one.',
    paras: [
      'In a four-stroke engine each stroke of the piston has one job: intake, compression, power and exhaust. Valves in the head open and close once every two revolutions. This is the design used by every current on-highway truck engine, because it breathes cleanly, separates fresh air from exhaust well, and is easier to make meet emissions limits. The four-stroke cycle section further down this page animates it on the sim engine.',
      'A two-stroke diesel gets a power stroke from every cylinder on every revolution. Near the bottom of the stroke, the piston uncovers ports in the cylinder wall and a blower forces fresh air in, which pushes the exhaust out through valves in the head. This is called scavenging. Because the engine cannot suck air in on its own, a two-stroke diesel always needs a blower or turbocharger.',
      'Two-stroke diesels such as the Detroit Diesel Series 71 and 92 were common in trucks and buses until the 1990s and are still found in older equipment and emergency generators. Large two-stroke diesels still power ships and locomotives (EMD), where their high power density is valuable. For trucks they were dropped mainly because they are hard to make clean: some scavenging air and oil escape unburned.',
    ],
    facts: [['Four-stroke', 'one power stroke per cylinder every 720° of crank rotation'], ['Two-stroke', 'one power stroke per cylinder every 360°'], ['On-highway trucks today', 'four-stroke, inline six, 11–16 L']],
  },
  {
    id: 'air',
    title: 'Air intake and turbocharging',
    lead: 'A diesel can only burn as much fuel as it has air for. Getting more air into each cylinder is the key to power, and getting clean, cool air is the key to long life and low emissions.',
    paras: [
      'Air enters through a dry paper air cleaner sized to stop fine dust, which would otherwise wear rings and liners in a few thousand miles. A restriction indicator shows when the filter is loading up. From there air goes to the turbocharger compressor, through the charge air cooler (an air-to-air radiator at the front of the truck), and into the intake manifold. On EGR engines, cooled exhaust gas is mixed in before the intake ports.',
      'The turbocharger is driven by exhaust energy that would otherwise be lost. Compressing the air raises its pressure, often to 2.5–3.5 bar absolute at full load, so each cylinder holds two to three times as much air as an engine without a turbo. Compressing air also heats it, which is why the charge air cooler is there: cooler air is denser and lowers combustion temperature and NOx.',
      'Most current engines use a variable geometry turbo (VGT). The ECM moves vanes in the turbine housing to give quick boost at low speed, to limit boost at high speed, to build the back-pressure needed to drive EGR, and to raise exhaust temperature for DPF regeneration. Older engines used a fixed turbo with a wastegate, and many pre-1990s engines and two-strokes used a gear-driven Roots blower.',
    ],
    facts: [['Typical full-load boost', '30–45 psi (2–3 bar gauge)'], ['Max air filter restriction', 'about 25 inH₂O (check the maker)'], ['Charge air temperature after cooler', 'about 40–50 °C'], ['Turbo shaft speed', '100,000+ rpm']],
    then: ['Fixed-geometry turbo with wastegate, or a gear-driven blower; no EGR.', 'VGT controlled by the ECM, cooled EGR mixed into the charge air.'],
  },
  {
    id: 'fuel',
    title: 'Fuel system and injection',
    lead: 'The fuel system has to deliver the right amount of clean fuel, at the right moment, broken into a fine mist that mixes with the air in about two thousandths of a second.',
    paras: [
      'The low-pressure side lifts fuel from the tank through a fuel-water separator and primary filter, then a fine secondary filter, to the high-pressure pump. Water and dirt are the enemies: modern injectors have clearances of a few microns, so a fuel filter change and draining water from the separator are essential services. Ultra-low sulfur diesel (ULSD, 15 ppm sulfur) has been required on-highway in the US since 2006 so the aftertreatment catalysts are not poisoned.',
      'In a high-pressure common rail system, a gear-driven pump keeps a rail full of fuel at up to about 2,500–2,700 bar, and the ECM opens each injector electrically. Since pressure is always available, the ECM can shape each combustion event with a pilot injection, a main injection and post injections, change injection timing instantly, and adjust rail pressure for load and speed. That control is what makes today\'s engines quieter, cleaner and more efficient.',
      'Injection timing matters as much as quantity. Injecting earlier (more advance) gives higher cylinder pressure, better fuel economy and more NOx; injecting later lowers NOx but raises soot and fuel use. Before electronic control this balance was fixed by the pump timing; now the ECM changes it every cycle based on load, speed, temperature and altitude.',
    ],
    facts: [['Common rail pressure', 'up to ~2,500–2,700 bar (36,000–39,000 psi)'], ['Injections per cycle', 'commonly 2–5 (pilot, main, post)'], ['Secondary filter rating', 'about 2–5 microns'], ['On-highway diesel sulfur limit (US)', '15 ppm (ULSD)']],
    then: ['Mechanical in-line or rotary pumps, then mechanical or electronic unit injectors driven by a cam lobe.', 'High-pressure common rail with electronically controlled injectors and multiple injections per cycle.'],
  },
  {
    id: 'governing',
    title: 'Governing and ECM control',
    lead: 'A governor holds engine speed where it is wanted as the load changes. On modern engines the governor is software in the ECM.',
    paras: [
      'Without a governor, a diesel would overspeed and destroy itself as soon as the load came off, because nothing in the air system limits it the way a throttle does in a gasoline engine. Mechanical governors used spinning flyweights against a spring: as speed rose, the weights flew out and pulled the fuel rack back. A min-max governor controlled only idle and top speed and let the driver control fuel in between (typical of trucks); a variable-speed (all-speed) governor held any speed the operator selected (typical of equipment and generators).',
      'The ECM does the same job digitally. It measures engine speed from the crankshaft position sensor many times per revolution, compares it with what the driver, cruise control, PTO or transmission is asking for, and adjusts the fuel commanded to each injector. It can be set up to behave like either governor type, holds a steady idle, cuts fuel at the programmed top speed (high idle), and limits road speed.',
      'The ECM also limits fuel so the engine does not smoke or overload: it allows only as much fuel as the measured boost can burn cleanly, and it applies torque limits to protect the transmission and driveline. These settings, along with idle shutdown timers, cruise settings and speed limits, are programmable customer parameters set with the maker\'s service software.',
    ],
    facts: [['Low idle', 'about 600–700 rpm'], ['Rated speed (13 L)', 'about 1,600–1,800 rpm'], ['High idle (no-load governed)', 'about 1,800–2,100 rpm'], ['Speed signal', 'crankshaft and camshaft position sensors']],
    then: ['Flyweight governor on the injection pump.', 'ECM software governing with programmable limits and drivetrain torque control.'],
  },
  {
    id: 'lube',
    title: 'Lubrication',
    lead: 'Oil keeps moving parts apart, carries heat out of the pistons and bearings, carries dirt to the filter, and protects against corrosion.',
    paras: [
      'A gear pump driven by the engine draws oil from the pan through a pickup screen and sends it through the oil cooler and full-flow filters into the main gallery. From there it feeds the main bearings, then through drillings in the crankshaft to the rod bearings, up to the camshaft and rocker shafts, to the turbocharger, air compressor and accessories, and out of the piston cooling jets that spray the underside of every piston. It drains back to the pan by gravity.',
      'The bearings run on a hydrodynamic oil film: the turning journal drags oil into the narrowing gap and builds a wedge of pressure that holds the parts apart. That film is only a few microns thick, so oil viscosity, cleanliness and supply all matter. Most wear happens in the seconds after a cold start before the oil reaches everything, and most turbo failures start with an oil supply problem.',
      'Oil specifications follow the engines. API CK-4 (2016) is the current heavy-duty category, designed to handle the soot from EGR, protect against oxidation at high temperatures, and stay compatible with the DPF (limited ash). FA-4 is a thinner, fuel-saving version used only where the engine maker allows it. Oil analysis at each change tracks wear metals, coolant, fuel dilution and soot, and is the cheapest way to find a problem before it becomes a failure.',
    ],
    facts: [['Oil pressure (typical)', '15–20 psi min at hot idle, 35–60 psi at rated'], ['Oil capacity (13 L engine)', 'about 40 L (10–11 gal)'], ['Current oil category', 'API CK-4 (FA-4 where approved)'], ['Common viscosity', 'SAE 15W-40 or 10W-30']],
  },
  {
    id: 'cooling',
    title: 'Cooling',
    lead: 'A quarter to a third of the fuel energy ends up as heat in the coolant and oil. The cooling system has to remove it, and keep the engine at a steady temperature, not just cool.',
    paras: [
      'The water pump circulates coolant through the oil cooler, around the cylinder liners, up through the head and, on EGR engines, through the EGR cooler. The thermostat stays closed on a cold engine, so coolant bypasses the radiator and the engine warms quickly; it opens at about 82 °C (180 °F) and sends coolant to the radiator, where a large fan pulls air through. The fan is engaged by the ECM through a viscous or air-operated clutch only when needed, because a heavy-duty fan can absorb 30+ kW.',
      'The system is pressurized (typically 7–15 psi) by the surge tank cap, which raises the boiling point well above 100 °C. Coolant is a 50/50 mix of water and glycol with inhibitors. Most new trucks use extended life coolant (organic acid technology) that needs little maintenance; older coolant types need additive (SCA) checks. The inhibitors also protect wet liners from cavitation erosion.',
      'Running too hot causes ring and piston scuffing, head gasket failure and oil breakdown; running too cold causes fuel dilution, sludge, wet stacking and poor regeneration. The ECM reads coolant temperature and level and will warn, derate or shut down the engine if they go out of range.',
    ],
    facts: [['Thermostat opens', 'about 82 °C (180 °F)'], ['Normal operating temperature', 'about 85–100 °C'], ['Cap pressure', 'about 7–15 psi'], ['Coolant mix', '50/50 glycol and water (−37 °C / −34 °F protection)']],
  },
  {
    id: 'starting',
    title: 'Starting',
    lead: 'To start, the engine must turn fast enough that compression heats the air above the fuel\'s ignition temperature. Cold weather makes that harder.',
    paras: [
      'Heavy-duty diesels are cranked by a 12 V electric starter (some use air starters, common on off-road equipment and some fleets). The starter pinion slides into the flywheel ring gear and turns the engine at roughly 100–200 rpm. That needs a lot of current, often 600–1,000 A or more in the cold, which is why trucks carry three or four batteries in parallel and why cable and ground connections are a common cause of slow cranking.',
      'In cold weather, the cylinder walls absorb heat from the compressed air and the oil is thick, so the air may not get hot enough. Modern heavy-duty engines use an electric grid heater in the intake manifold, controlled by the ECM, to warm the intake air before and just after starting; many light- and medium-duty diesels use glow plugs in each cylinder instead. Block heaters (plugged in overnight) keep the coolant and oil warm. Ether starting aids are still used on some engines but can damage an engine with a grid heater or glow plugs.',
      'When an engine cranks but will not start, check the basics in order: cranking speed, fuel supply (air in the system, plugged filters, gelled fuel in the cold), rail pressure on the scan tool, and the cam and crank sensor signals the ECM needs to know when to inject.',
    ],
    facts: [['Cranking speed needed', 'about 100–200 rpm'], ['Starter current (cold)', '600–1,000+ A'], ['Batteries', '3–4 × 12 V in parallel'], ['Cold start aid', 'ECM-controlled grid heater; block heater']],
  },
  {
    id: 'protection',
    title: 'Engine protection',
    lead: 'An engine can destroy itself in seconds without oil or coolant. Protection systems warn the driver and, if needed, reduce power or stop the engine.',
    paras: [
      'Older engines used mechanical shutdowns: a pressure switch that dropped the fuel rack on low oil pressure, a temperature switch, and an overspeed trip that closed an air shutoff on runaway. These still exist on industrial engines and generators.',
      'On a modern truck engine the ECM watches oil pressure, coolant temperature and level, intake and exhaust temperature, crankcase pressure, engine speed and the aftertreatment. When a reading goes out of range it lights a warning lamp and logs a fault code. If the condition gets worse it derates (reduces available power), and if it reaches the shutdown limit it flashes the stop lamp and stops the engine, usually after a 30-second warning, if the shutdown feature is enabled.',
      'Fault codes on J1939 are made of an SPN (what: for example SPN 100, engine oil pressure) and an FMI (how: for example FMI 1, data valid but below normal operating range). Emissions faults can also trigger a staged speed limit (inducement) if, for example, the DEF tank is empty or the wrong fluid is used. The Diagnostic tools page reads these codes the same way a shop scan tool does.',
    ],
    facts: [['Warning', 'amber lamp + fault code'], ['Derate', 'reduced torque or speed'], ['Shutdown', 'red stop lamp, ~30 s countdown'], ['Code format (J1939)', 'SPN + FMI, e.g. 100/1']],
    then: ['Mechanical switches and trips on oil pressure, temperature and overspeed.', 'ECM monitoring with warning, derate and shutdown stages and stored fault codes.'],
  },
  {
    id: 'emissions',
    title: 'Emissions and aftertreatment',
    lead: 'Since 2010, US heavy-duty engines must emit about 98% less NOx and particulate than before 1990. Most of that is done in the exhaust, after the engine.',
    paras: [
      'Inside the engine, cooled EGR and precise injection control keep NOx and soot low to begin with. The exhaust then flows through the aftertreatment system, usually packaged in one box under the cab: a diesel oxidation catalyst (DOC), a diesel particulate filter (DPF), and a selective catalytic reduction (SCR) catalyst, with sensors for temperature, pressure and NOx in and out.',
      'The DOC uses platinum and palladium to burn carbon monoxide and hydrocarbons and to make heat for regeneration. The DPF is a ceramic honeycomb (cordierite or silicon carbide) whose channels are blocked at alternate ends, so exhaust must pass through the porous walls, trapping over 95% of soot. The soot is burned off by regeneration: passively during hard work, or actively when the ECM adds fuel (by post injection or a doser) to heat the DOC and raise DPF temperature to about 550–650 °C. Ash from oil additives does not burn, so DPFs are removed and cleaned at long intervals.',
      'SCR removes NOx. Diesel exhaust fluid (DEF, 32.5% urea in water) is sprayed into the exhaust, where it breaks down into ammonia. On the SCR catalyst the ammonia reacts with NOx to make nitrogen and water. DEF use runs at roughly 2–3% of fuel use. The ECM watches NOx sensors and DEF quality; problems set codes and, if not fixed, a speed-limiting inducement. A newer, tighter EPA NOx standard begins with 2027 model year engines.',
    ],
    facts: [['DOC', 'burns CO and HC; heats exhaust for regen'], ['DPF', 'traps >95% of soot; regenerates at ~550–650 °C'], ['SCR + DEF', 'converts NOx to nitrogen and water'], ['DEF', '32.5% urea, ~2–3% of fuel use']],
    then: ['Before 2007 most trucks had no particulate filter or SCR; visible black smoke was common.', 'DOC + DPF + SCR with DEF on every on-highway engine since 2010.'],
  },
];

export function mountSystems(root: HTMLElement) {
  root.innerHTML = `
    <h2>Diesel engine systems</h2>
    <p class="muted small" style="margin:-4px 0 10px">How each system on a modern heavy-duty diesel works, what the numbers usually are, and how it differs from older engines you may still see.</p>
    <div class="phGrid">
      <div class="phList" id="syList">${SYSTEMS.map((t, i) => `<button data-t="${t.id}" class="${i === 0 ? 'on' : ''}"><b>${i + 1} · ${esc(t.title)}</b></button>`).join('')}</div>
      <div class="phBody" id="syBody"></div>
    </div>`;
  const body = root.querySelector('#syBody') as HTMLElement;
  const show = (id: string) => {
    const i = SYSTEMS.findIndex((x) => x.id === id);
    const t = SYSTEMS[i];
    root.querySelectorAll('#syList button').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.t === id));
    body.innerHTML = `<h3>${esc(t.title)}</h3><p class="phLead">${esc(t.lead)}</p>
      ${t.paras.map((p) => `<p>${esc(p)}</p>`).join('')}
      ${t.facts ? `<table class="syFacts">${t.facts.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>` : ''}
      ${t.then ? `<div class="syThen"><div><span class="k">Older engines</span>${esc(t.then[0])}</div><div><span class="k">Current engines</span>${esc(t.then[1])}</div></div>` : ''}
      <div class="bar" style="margin-top:12px">${i > 0 ? '<button data-step="-1">◂ Previous</button>' : ''}${i < SYSTEMS.length - 1 ? '<button data-step="1" class="dark">Next system ▸</button>' : ''}</div>`;
  };
  root.querySelector('#syList')!.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button[data-t]') as HTMLElement | null;
    if (b) show(b.dataset.t!);
  });
  body.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button[data-step]') as HTMLElement | null;
    if (!b) return;
    const cur = root.querySelector('#syList button.on') as HTMLElement;
    show(SYSTEMS[SYSTEMS.findIndex((t) => t.id === cur.dataset.t) + +b.dataset.step!].id);
  });
  show(SYSTEMS[0].id);
}
