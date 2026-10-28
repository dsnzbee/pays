import katex from 'katex'
import { G, MU0, gradeById, materialById } from '../physics/constants'
import type { Lane } from '../physics/lanes'
import type { Simulation } from '../physics/sim'

function Tex({ children, block = false }: { children: string; block?: boolean }) {
  const html = katex.renderToString(children, { displayMode: block, throwOnError: false })
  return block ? <div className="eq" dangerouslySetInnerHTML={{ __html: html }} /> : <span dangerouslySetInnerHTML={{ __html: html }} />
}

/** number → LaTeX with 3 significant figures (scientific notation when needed) */
function n(x: number, sig = 3): string {
  if (!isFinite(x)) return '\\infty'
  if (x === 0) return '0'
  const a = Math.abs(x)
  if (a >= 1e3 || a < 1e-2) {
    const e = Math.floor(Math.log10(a))
    return `${(x / 10 ** e).toPrecision(sig)}\\times10^{${e}}`
  }
  return x.toPrecision(sig)
}

interface Step {
  title: string
  tex: string
}

/** Live numbers of the bottom lane substituted into the chain  B → k → τ → x_stop → v_c → Rm → δ → heat → ΔT. */
function worked(sim: Simulation): Step[] {
  const lane: Lane = sim.lanes[1].cfg.brake === 'eddy' ? sim.lanes[1] : sim.lanes[0]
  const p = lane.cfg.p
  const mat = materialById(p.materialId)
  const d = p.thicknessMm / 1000
  const sig = mat.sigma

  if (p.scenario === 'tube') {
    const L: any = lane
    const a = L.geometry.a
    const w = L.geometry.w
    const m = L.magnetMass
    const pd = L.dipole
    const k = L.kConst
    const vt = (m * G) / k
    const Rm = MU0 * sig * vt * w
    return [
      { title: 'Dipole moment of the magnet  p = Br·V/μ₀', tex: `p=${n(pd)}\\ \\mathrm{A\\,m^2}\\quad(B_r=${n(gradeById(p.gradeId).Br)}\\ \\mathrm T)` },
      { title: 'Drag coefficient  k = (45/1024) μ₀² p² σ w / a⁴', tex: `k=\\tfrac{45}{1024}\\,\\dfrac{(${n(MU0)})^2(${n(pd)})^2(${n(sig)})(${n(w)})}{(${n(a)})^4}=${n(k)}\\ \\mathrm{N\\,s/m}` },
      { title: 'Terminal speed  v_t = m g / k', tex: `v_t=\\dfrac{(${n(m)})(${n(G)})}{${n(k)}}=${n(vt)}\\ \\mathrm{m/s}` },
      { title: 'Time constant  τ = m / k', tex: `\\tau=\\dfrac{${n(m)}}{${n(k)}}=${n(m / k)}\\ \\mathrm{s}` },
      { title: 'Magnetic Reynolds number at v_t  Rm = μ₀ σ v w', tex: `R_m=(${n(MU0)})(${n(sig)})(${n(vt)})(${n(w)})=${n(Rm)}\\ \\ll 1\\ \\Rightarrow\\ \\text{linear regime}` },
      { title: 'Power dissipated at v_t  P = m g v_t', tex: `P=${n(m * G * vt)}\\ \\mathrm{W}\\quad(\\text{all of the lost potential energy becomes heat in the pipe})` },
    ]
  }

  const t = lane.table!
  const s = lane.s
  const Bgap = s * t.Bc1
  const kConst = lane.kConst
  const Khat = kConst / (sig * d * s * s)
  const isRail = p.scenario === 'rail'
  const isDisc = p.scenario === 'disc'
  const m = isRail ? p.mass : isDisc ? p.discMass : p.pendMass
  const rm = isDisc ? (0.75 * p.discRmm) / 1000 : 1
  const w0 = (p.discRpm * 2 * Math.PI) / 60
  const v0 = isRail ? p.v0 : isDisc ? w0 * rm : Math.sqrt(2 * G * p.pendLen * (1 - Math.cos((p.theta0 * Math.PI) / 180)))
  const Ieff = isDisc ? 0.5 * p.discMass * (p.discRmm / 1000) ** 2 : m
  const tau = isDisc ? Ieff / (kConst * rm * rm) : m / kConst
  const w2 = 2 / (MU0 * sig * d)
  const Rm0 = MU0 * sig * v0 * d
  const omega = (Math.PI * v0) / t.pitch
  const delta = Math.sqrt(2 / (MU0 * sig * omega))
  const Q = isDisc ? 0.5 * Ieff * w0 * w0 : 0.5 * m * v0 * v0
  const V = isDisc ? Math.PI * (p.discRmm / 1000) ** 2 * d : t.Lf * t.Hf * t.maskFrac * d
  const C = mat.rho * mat.cp * V
  const steps: Step[] = [
    {
      title: p.source === 'permanent' ? 'Gap field  B = Br · B̂  (B̂ from the cuboid model, back iron included)' : 'Gap field  B = min(μ₀NI/g, 1.6 T)',
      tex: p.source === 'permanent' ? `B=${n(s)}\\times${n(t.Bc1)}=${n(Bgap)}\\ \\mathrm T` : `B=\\min\\!\\left(\\dfrac{\\mu_0 NI}{g},1.6\\right)=${n(Bgap)}\\ \\mathrm T`,
    },
    {
      title: 'Brake coefficient  k = σ d K̂ B²  (K̂ = plate-averaged 2D-solver result)',
      tex: `k=(${n(sig)})(${n(d)})(${n(Khat)})(${n(s)})^2=${n(kConst)}\\ \\mathrm{N\\,s/m}`,
    },
    isDisc
      ? { title: 'Time constant  τ = I / (k r_m²)', tex: `\\tau=\\dfrac{${n(Ieff)}}{(${n(kConst)})(${n(rm)})^2}=${n(tau)}\\ \\mathrm s` }
      : { title: isRail ? 'Time constant  τ = m / k' : 'Damping time  τ = m / k  (θ̈ = −(g/L) sin θ − θ̇/τ)', tex: `\\tau=\\dfrac{${n(m)}}{${n(kConst)}}=${n(tau)}\\ \\mathrm s` },
  ]
  if (isRail) steps.push({ title: 'Ideal stopping distance  x = m v₀ / k', tex: `x=\\dfrac{(${n(m)})(${n(v0)})}{${n(kConst)}}=${n((m * v0) / kConst)}\\ \\mathrm m` })
  steps.push(
    { title: 'Saturation speed  w = v_c = 2 / (μ₀ σ d)  (thin-sheet limit)', tex: `v_c=\\dfrac{2}{(${n(MU0)})(${n(sig)})(${n(d)})}=${n(w2)}\\ \\mathrm{m/s}` },
    { title: 'Magnetic Reynolds number at the start  Rm = μ₀ σ v₀ d', tex: `R_m=(${n(MU0)})(${n(sig)})(${n(v0)})(${n(d)})=${n(Rm0)}\\ \\Rightarrow\\ \\text{${Rm0 < 0.2 ? 'low-speed' : Rm0 < 2 ? 'transition' : 'high-speed'}}` },
    { title: 'Skin depth at the start  ω = π v₀/τp,  δ = √(2/(μ₀σω))', tex: `\\omega=\\dfrac{\\pi(${n(v0)})}{${n(t.pitch)}}=${n(omega)}\\ \\mathrm{s^{-1}},\\quad \\delta=${n(delta * 1000)}\\ \\mathrm{mm}\\ \\ (d=${n(d * 1000)}\\ \\mathrm{mm})` },
    { title: 'Heat  Q = initial kinetic energy', tex: `Q=${isDisc ? '\\tfrac12 I\\omega_0^2' : '\\tfrac12 m v_0^2'}=${n(Q)}\\ \\mathrm J` },
    { title: 'Temperature rise  ΔT = Q / (ρ c_p V)', tex: `\\Delta T=\\dfrac{${n(Q)}}{(${n(mat.rho)})(${n(mat.cp)})(${n(V)})}=${n(Q / C)}\\ \\mathrm K` },
  )
  return steps
}

export function Theory({ sim, onClose }: { sim: Simulation; onClose: () => void }) {
  const steps = worked(sim)
  const lane = sim.lanes[1].cfg.brake === 'eddy' ? sim.lanes[1] : sim.lanes[0]
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer">
        <button className="btn close" onClick={onClose}>Close</button>
        <h2>How an eddy-current brake works</h2>
        <p>A magnet and a conductor move relative to each other. No contact, no pads, no wear. Everything below is what this simulator actually computes.</p>

        <h4>Worked calculation · live ({lane.cfg.label})</h4>
        <p style={{ fontSize: 12, color: 'var(--muted)' }}>Updates with your sliders. Each line substitutes the numbers of the current run into the formula in its title.</p>
        {steps.map((s, i) => (
          <div className="step" key={i}>
            <b>{i + 1}</b>
            <div>
              <p>{s.title}</p>
              <Tex block>{s.tex}</Tex>
            </div>
          </div>
        ))}

        <h4>1 · Faraday and Lenz</h4>
        <p>A conductor moving with velocity <Tex>{'\\mathbf v'}</Tex> through a field <Tex>{'\\mathbf B'}</Tex> sees a motional EMF: the Lorentz force <Tex>{'q\\,\\mathbf v\\times\\mathbf B'}</Tex> pushes the free charges.</p>
        <Tex block>{'\\varepsilon = B\\,L\\,v,\\qquad \\mathbf J=\\sigma(\\mathbf E+\\mathbf v\\times\\mathbf B)'}</Tex>
        <p>
          Faraday: <Tex>{'\\varepsilon=-\\mathrm d\\Phi/\\mathrm dt'}</Tex>. Lenz: the induced current's own field opposes the change in flux, so{' '}
          <Tex>{'\\mathbf J\\times\\mathbf B'}</Tex> points against <Tex>{'\\mathbf v'}</Tex>. In the <span className="cool">plan-section inset</span> the field <Tex>{'\\mathbf B'}</Tex> crosses the gap, the current <Tex>{'J_z'}</Tex> is drawn as ⊙ / ⊗, and the resulting force <Tex>{'\\mathbf F'}</Tex> is opposite to <Tex>{'\\mathbf v'}</Tex>.
        </p>

        <h4>2 · How eddy currents form</h4>
        <p>
          Under a pole the EMF drives current across the plate; the current cannot stop at the edge of the field, so it returns through the field-free metal on both sides.
          The result is a pair of counter-rotating vortices at the leading and trailing edge of each pole (the <span className="cool">streamlines</span> on the plate).
          Only the part of the plate that overlaps the field is a source; the rest is the return path. That is why the force ramps up as the fin enters the array.
        </p>

        <h4>3 · The Poisson formulation used by the solver</h4>
        <p>At low magnetic Reynolds number the applied field is not modified by the eddy currents. For a thin plate in the x–z plane, with <Tex>{'\\mathbf v=v\\hat x'}</Tex> and <Tex>{'\\mathbf E=-\\nabla\\varphi'}</Tex>:</p>
        <Tex block>{'J_x=-\\sigma\\frac{\\partial\\varphi}{\\partial x},\\qquad J_z=\\sigma\\left(-\\frac{\\partial\\varphi}{\\partial z}+v\\,B_y\\right)'}</Tex>
        <p>Charge conservation <Tex>{'\\nabla\\!\\cdot\\!\\mathbf J=0'}</Tex> gives</p>
        <Tex block>{'\\nabla^2\\varphi=\\nabla\\!\\cdot\\!(\\mathbf v\\times\\mathbf B)=v\\,\\frac{\\partial B_y}{\\partial z},\\qquad \\mathbf J\\cdot\\mathbf n=0\\ \\text{on edges and slots}'}</Tex>
        <p>
          It is discretised on a 120 × 40 grid and solved by preconditioned conjugate gradients. Since <Tex>{'\\mathbf J\\propto v'}</Tex> and <Tex>{'\\sigma'}</Tex> factors out,
          one solve per plate position gives <Tex>{'\\hat K(x)'}</Tex> for all speeds and materials:
        </p>
        <Tex block>{'F=\\sigma\\,d\\,\\hat K\\,B^2\\,v,\\quad \\hat K=\\iint \\hat J_z\\hat B_y\\,\\mathrm dA,\\quad P=\\sigma\\,d\\,v^2\\!\\iint|\\hat{\\mathbf J}|^2\\mathrm dA=F\\,v'}</Tex>
        <p>The table <Tex>{'\\hat K(x)'}</Tex> is computed once per geometry in a Web Worker and reused every frame. The "P = F·v check" row compares the two integrals.</p>

        <h4>4 · F = k v and the exponential solution</h4>
        <Tex block>{'m\\dot v=-k\\,v\\ \\Rightarrow\\ v(t)=v_0\\,e^{-t/\\tau},\\quad \\tau=\\frac mk,\\quad x_{stop}=\\int_0^\\infty v\\,\\mathrm dt=v_0\\,\\tau=\\frac{m v_0}{k}'}</Tex>
        <p>
          Validation mode makes the field uniform (the interior-averaged <Tex>{'\\bar k'}</Tex>), switches off friction and heating and overlays this analytic curve on the speed plot with the live error.
          There is <strong>no holding force</strong>: <Tex>{'F\\to0'}</Tex> as <Tex>{'v\\to0'}</Tex>.
        </p>

        <h4>5 · Skin effect and the high-speed regime</h4>
        <p>With alternating poles of pitch <Tex>{'\\tau_p'}</Tex> the plate sees a field reversing at <Tex>{'\\omega=\\pi v/\\tau_p'}</Tex>; the field penetrates a skin depth <Tex>{'\\delta=\\sqrt{2/(\\mu_0\\sigma\\omega)}'}</Tex>.</p>
        <Tex block>{'d_{eff}=\\delta\\tanh\\frac d\\delta,\\qquad w=\\frac{2}{\\mu_0\\sigma d_{eff}},\\qquad F=\\frac{\\sigma d_{eff}\\hat K B^2\\,v}{1+(v/w)^2}'}</Tex>
        <p>
          <strong>Why this model:</strong> it interpolates the two asymptotes — thin sheet (<Tex>{'d\\ll\\delta'}</Tex>, Reitz) with <Tex>{'F\\propto1/v'}</Tex> and thick plate (<Tex>{'d\\gg\\delta'}</Tex>) with{' '}
          <Tex>{'F\\propto v^{-1/2}'}</Tex> — without solving the field-diffusion equation across the thickness. The regime label uses <Tex>{'R_m=\\mu_0\\sigma v d'}</Tex>:
          &lt; 0.2 low-speed linear, 0.2–2 transition, &gt; 2 high-speed. The force peaks near <Tex>{'v\\approx w'}</Tex>, marked on the F(v) plot.
        </p>

        <h4>6 · Joule heating and brake fade</h4>
        <Tex block>{'C\\,\\frac{\\mathrm dT}{\\mathrm dt}=F\\,v-hA\\,(T-T_{amb}),\\quad C=\\rho c_p V,\\quad \\sigma(T)=\\frac{\\sigma_{20}}{1+\\alpha(T-20\\,^\\circ\\mathrm C)}'}</Tex>
        <p>All kinetic energy removed is dissipated in the plate, so a hot plate (higher resistivity) brakes slightly less. The friction-brake lane has its own cast-iron disc and pad pair (Section 12) with a constant force <Tex>{'F'}</Tex>; their thermal mass can be sized from hardware or set equal to the fin&apos;s.</p>

        <h4>7 · Slotted plates</h4>
        <p>
          Slots cut from the free edge are cells with <Tex>{'\\sigma=0'}</Tex> in the solver and <Tex>{'\\mathbf J\\cdot\\mathbf n=0'}</Tex> on their walls. The currents can no longer close in large loops and are forced into small ones,
          so <Tex>{'\\hat K'}</Tex> drops. That is the classic Waltenhofen demonstration: the solid plate stops dead in the magnet gap, the slotted one swings through.
        </p>

        <h4>8 · Falling magnet in a pipe (Lenz tube)</h4>
        <p>Model the magnet as a point dipole <Tex>{'p=B_rV/\\mu_0'}</Tex> on the axis of a thin-walled pipe (mean radius <Tex>{'a'}</Tex>, wall <Tex>{'w'}</Tex>). The flux through a ring at axial distance <Tex>{'z'}</Tex>:</p>
        <Tex block>{'\\Phi(z)=\\frac{\\mu_0\\,p\\,a^2}{2\\,(a^2+z^2)^{3/2}}\\quad\\Rightarrow\\quad \\varepsilon=v\\left|\\frac{\\mathrm d\\Phi}{\\mathrm dz}\\right|=\\frac{3\\mu_0 p a^2 v\\,|z|}{2(a^2+z^2)^{5/2}}'}</Tex>
        <p>The ring (circumference <Tex>{'2\\pi a'}</Tex>) carries <Tex>{'J=\\sigma\\varepsilon/2\\pi a'}</Tex>. Sum the Joule power over rings, <Tex>{'\\mathrm dV=2\\pi a\\,w\\,\\mathrm dz'}</Tex>:</p>
        <Tex block>{'P=\\frac{\\sigma w}{2\\pi a}\\int_{-\\infty}^{\\infty}\\varepsilon^2\\mathrm dz=\\frac{9\\mu_0^2p^2\\sigma w\\,a^{3}v^2}{8\\pi}\\int_{-\\infty}^{\\infty}\\!\\frac{z^2\\,\\mathrm dz}{(a^2+z^2)^5},\\qquad \\int_{-\\infty}^{\\infty}\\!\\frac{z^2\\,\\mathrm dz}{(a^2+z^2)^5}=\\frac{5\\pi}{128\\,a^7}'}</Tex>
        <Tex block>{'P=\\frac{45}{1024}\\frac{\\mu_0^2p^2\\sigma w}{a^4}\\,v^2\\ \\Rightarrow\\ F=\\frac Pv=k\\,v,\\quad k=\\frac{45}{1024}\\frac{\\mu_0^2p^2\\sigma w}{a^4},\\quad v_t=\\frac{mg}{k}'}</Tex>
        <p>
          The magnet approaches terminal speed with <Tex>{'\\tau=m/k'}</Tex>; the PVC lane (σ ≈ 0) is in free fall. Source: Y. Levin, F. L. da Silveira, F. B. Rizzato, <em>Electromagnetic braking: A simple quantitative model</em>, Am. J. Phys. 74 (2006).
          The point-dipole approximation under-estimates the drag when the magnet radius is comparable to the pipe radius, so measured terminal speeds are usually lower than computed here.
        </p>

        <h4>9 · Magnet model</h4>
        <p>
          Each NdFeB block (N35 1.17 T, N42 1.30 T, N52 1.44 T) is a uniformly magnetised cuboid, evaluated with the closed-form surface-charge expression{' '}
          <Tex>{'B_y=\\frac{B_r}{4\\pi}\\sum_{i,j,k}(-1)^{i+j+k}\\arctan\\frac{(x-x_i)(z-z_k)}{(y-y_j)\\,r_{ijk}}'}</Tex>.
          Two facing rows with alternating polarity are superposed. The steel U-channel is modelled by the method of images (infinite permeability: effective magnet thickness doubles).
          The electromagnet option uses <Tex>{'B=\\mu_0NI/g'}</Tex> clamped at 1.6 T, with the same fringing shape.
        </p>

        <h4>10 · Assumptions and limitations</h4>
        <ul>
          <li>Low-Rm Poisson model: the eddy currents' reaction field enters only through the tanh / Reitz correction, not self-consistently.</li>
          <li>Thin plate: B_y taken at the mid-plane, in-plane currents only (no J_y).</li>
          <li>Steel back iron: infinite permeability, no saturation, no leakage; non-ferromagnetic fins (no attraction force).</li>
          <li>Lumped plate temperature; uniform σ(T) across the plate.</li>
          <li>Pendulum: the plate translates through the gap; plate rotation is neglected. Disc: a straight patch of the rim stands for the arc.</li>
          <li>Tube: point dipole, thin wall, no eccentricity or tilt.</li>
        </ul>

        <h4>11 · Where it is used</h4>
        <ul>
          <li><strong>Trains:</strong> linear eddy-current brakes acting on the rails (ICE 3) and eddy-current brakes on high-speed rolling stock (Shinkansen).</li>
          <li><strong>Roller coasters:</strong> fixed magnet rows with a fin on the car, so the brake works with no power and no contact.</li>
          <li><strong>Exercise bikes:</strong> an aluminium or copper flywheel with an adjustable magnet.</li>
          <li><strong>Dynamometers and truck retarders:</strong> eddy-current absorbers that turn shaft power into heat.</li>
        </ul>

        <h4>12 · A fair eddy-vs-friction comparison</h4>
        <p>The two brakes have different force laws, so “which stops shorter” depends on how you match them. With the same peak force <Tex>{'F_0'}</Tex>:</p>
        <Tex block>{'F_{eddy}=k\\,v\\ \\Rightarrow\\ x_e=\\frac{m v_0}{k},\\qquad F_{fric}=F\\ \\Rightarrow\\ x_f=\\frac{m v_0^2}{2F}'}</Tex>
        <Tex block>{'F=k v_0\\ \\Rightarrow\\ \\frac{x_e}{x_f}=2'}</Tex>
        <p>
          The eddy force is largest at the start and fades as the cart slows (an exponential tail), while friction keeps pulling at full strength until the end. Both brakes remove the same energy, which is the area under <Tex>{'F(x)'}</Tex>: for eddy a triangle <Tex>{'\\tfrac12F_0x_e'}</Tex> (<Tex>{'F=k v=k v_0-k^2x/m'}</Tex>, linear in <Tex>{'x'}</Tex>), for friction a rectangle <Tex>{'F_0x_f'}</Tex>, hence the factor 2.
          The simulator reproduces it in validation conditions (no rolling resistance, no heating, linear force); both distances are counted down to 0.01 m/s, which makes the exact figure <Tex>{'2/(1+v_{stop}/v_0)'}</Tex>, e.g. 1.998 for the default cart.
          In real conditions the eddy force saturates at high speed (<Tex>{'G(v)<1'}</Tex>, Section 5), so the peak that is actually reached is below <Tex>{'k v_0'}</Tex> and the ratio falls below 2.
        </p>
        <p>
          <strong>Match by</strong> chooses the friction force: <em>equal peak force</em> uses the largest force the eddy lane really reaches (a pre-run of the eddy lane), <em>equal stopping distance</em> finds by a secant iteration on a pre-run the force that stops the friction lane at the
          eddy stopping distance, and <em>manual</em> uses <Tex>{'\\mu_k N'}</Tex>. Both brakes engage when the fin&apos;s leading edge reaches the first magnet, and braking distance and time are counted from there.
        </p>
        <p><strong>Energy.</strong> Both lanes start with the same <Tex>{'\\tfrac12 m v_0^2'}</Tex>. All of it ends as heat in the brake except the small rolling loss <Tex>{'C_{rr} m g\\,x'}</Tex>, so the heat totals agree within a fraction of a percent (checked within 1 %). The temperature rise is then set by the thermal mass alone:</p>
        <Tex block>{'\\Delta T=\\frac{E}{m\\,c}'}</Tex>
        <p>
          <em>Realistic</em> sizes the friction brake from hardware: a cast-iron disc of 1.6 % of the vehicle mass (<Tex>{'c=460\\ \\mathrm{J/kg\\,K}'}</Tex>) and a semi-metallic pad pair (4 % of the disc mass, <Tex>{'c=1000'}</Tex>); the fin is its real geometry
          (<Tex>{'0.5\\times0.2\\ \\mathrm m'}</Tex>, density and <Tex>{'c_p'}</Tex> of the chosen metal, minus the slots). <em>Equal m·c</em> gives the friction brake the fin&apos;s heat capacity, so the same energy produces the same <Tex>{'\\Delta T'}</Tex>.
          The friction heat splits between disc and pads by the thermal effusivities <Tex>{'e=\\sqrt{k\\rho c}'}</Tex> (Charron): the disc takes <Tex>{'e_d/(e_d+e_p)\\approx0.85'}</Tex> and the pads the rest, which is why the lighter pads run hotter than the disc.
        </p>
        <p><strong>Where eddy braking really wins</strong> (none of it follows from the stopping distance):</p>
        <ul>
          <li><strong>No contact.</strong> No pad wear, dust or noise, and the force does not depend on a friction coefficient that drops when the pads are wet, glazed or hot.</li>
          <li><strong>Smooth.</strong> The force rises with speed and fades to zero at rest, so there is no stick-slip and no jerk at the end of the stop.</li>
          <li><strong>It can be built into the track.</strong> The magnets can sit along the track with the fin on the car, or the reverse. Then the heat goes into a conductor of any size, which you can ventilate freely, where a disc has to be small and rotating.</li>
          <li><strong>No power needed</strong> with permanent magnets (roller coasters).</li>
        </ul>
        <p>Where it loses: <strong>no holding force</strong> at rest (<Tex>{'F\\to0'}</Tex>), so trains still need friction brakes to stop completely, the force saturates and then falls at high speed, and the conductor heats and its <Tex>{'\\sigma(T)'}</Tex> drops. In this simulator the pad-wear and wet-pad claims are stated, not modelled.</p>

        <h4>References</h4>
        <p className="refs">
          Levin, da Silveira, Rizzato, Am. J. Phys. 74, 815 (2006) · Reitz, J. Appl. Phys. 41, 2067 (1970) · Wouterse, IEE Proc. B 138, 153 (1991) ·
          Yang et al., Supercond. Sci. Technol. 3, 591 (1990) and Engel-Herbert &amp; Hesjedal, J. Appl. Phys. 97, 074504 (2005) for the cuboid field.
        </p>
      </aside>
    </>
  )
}
