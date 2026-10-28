# Eddy current brake simulator

Interactive, SI-unit simulation of eddy-current braking: Vite + React + TypeScript, Canvas 2D, KaTeX.
Four scenarios, two comparison lanes each, a real 2D eddy-current solver, a cuboid-magnet field model, and a live worked calculation.

```
npm install
npm run dev        # http://localhost:5173
npm run check      # physics self-checks (energy, P = F·v, solver, validation)
npm run build
```

## Fonts
Gilroy is commercial and not bundled. Put `Gilroy-Regular|Medium|SemiBold|Bold.woff2` (or `.otf`) in `public/fonts/`.
Without them the app falls back to Manrope (Google Fonts), then the system sans-serif.

## Scenarios (top of the side panel)
| Scenario | What it shows | Comparison modes |
|---|---|---|
| Linear brake | Cart with a fin passing **between two rows of NdFeB magnets** in a steel U-channel | eddy vs none · eddy vs friction brake · solid vs slotted · material · magnet grade · thickness · air gap |
| Lenz tube | Dipole magnet falling in a thin-walled pipe (default 12 mm N42 sphere, 15 mm × 1 mm copper pipe) | copper vs PVC · material · wall · grade |
| Waltenhofen pendulum | Plate swinging through a magnet gap, full nonlinear θ'' | solid vs slotted · material · gap · grade |
| Rotating disc | Disc with a magnet pair at radius r_m | eddy vs none · material · grade · gap |

### Brake zone (rail)
- **Until stop (default):** the magnet array has no end. The 2D solver runs once for the entry ramp plus one periodic interior period (2·τp); k(x) is then tiled forever, so the cart can never roll out of the brake. Magnets are drawn only where they are on screen.
- **Finite (N pairs):** the old behaviour, with an exit ramp.
- **Both brakes** (magnets and friction pads) start acting at the same instant: when the fin's leading edge reaches the first magnet. Braking distance and braking time are counted from there. The friction brake then acts until stop.
- A rail lane is **stopped** when v < 0.01 m/s (rolling resistance C_rr = 0.002 finishes the job), and is then frozen. The readouts show the simulated stopping distance next to the ideal one: eddy `m·v₀/k̄` (low-speed, uniform field), friction `m·v₀²/(2(μN + C_rr m g))`. The eddy ideal is much shorter than the simulated value at high speed because of the saturation (Section 5 below), which is the point of showing both.

### Fair eddy vs friction comparison (rail, "Eddy brake vs friction brake")
Friction stops in less distance than eddy for equal peak force, and that is correct physics, not a bug: F_eddy = k·v fades as the cart slows, x = m·v₀/k, whereas friction is constant, x = m·v₀²/(2F). With F = k·v₀ the ratio is exactly x_eddy / x_friction = 2.

**Match by** (Scenario section) chooses the friction force:
- **Equal peak force (default):** F_friction = the largest force the eddy lane reaches in a pre-run. In the linear regime that is k̄·v₀; at high speed the eddy force saturates (Section 5), so the real peak is lower (e.g. 4.0 kN instead of 17.1 kN for the default cart) and the readout "Eddy distance / friction distance = … (theory: 2)" shows what actually happens. In validation mode (uniform field, no rolling resistance, no heating, linear) it is 2 to within the 0.01 m/s stop threshold: the ratio is exactly 2/(1 + v_stop/v₀).
- **Equal stopping distance:** a secant iteration on pre-runs finds the friction force that stops at the eddy lane's stopping distance.
- **Manual:** F = μ_k·N from the sliders.
The friction clamp force N = F/μ_k is shown.

**Energy.** One bar per lane splits E₀ = ½mv₀² into heat in the brake / rolling loss / kinetic energy left. Both lanes end with the same heat total to within the rolling-loss difference (< 1 %, checked).

**Thermal mass** (Conductor section) and ΔT = E/(m·c):
- *Realistic:* the eddy fin is its real geometry (0.5 × 0.2 m × thickness, ρ and c_p of the chosen metal, minus slots; 4.5 kg and 1.7 kJ/K for 5 mm copper). The friction brake is a cast-iron disc of 1.6 % of the vehicle mass (ρ 7100, c 460, h·A from 0.03 m²/kg; 6.4 kg for 400 kg) plus a pad pair of 4 % of the disc mass (c 1000).
- *Equal m·c:* the friction brake gets the fin's heat capacity (and cooling hA), split between disc and pads in the heat-partition ratio, so disc, pad and fin all warm by the same ΔT for the same energy.
- **Disc / pad heat split:** Charron's partition for two sliding bodies, disc fraction γ = e_d/(e_d + e_p) with thermal effusivity e = √(k ρ c) (k 52 / 2 W/m·K for iron / semi-metallic pad), γ ≈ 0.85. The lighter pads run hotter. Both are lumped bodies (pad has no conduction to its holder).
- The readout lists m, m·c, E/(m·c) and the measured rise for every body; the difference is convection.
The disc and pad figures are typical engineering values, not measured data; check them before quoting them. Pad wear and wet-pad fade are described in the Theory drawer but not modelled.

### Interface
Calm by default: two lanes, one force arrow, faint streamlines on the fin, one big speed readout per lane. Everything else is behind **Layers** (|J| heat-map, B-field symbols, cross-section card, velocity arrow, scale bar, labels) in the side panel, which is an accordion (Scenario, Readouts, Vehicle, Magnets, Conductor, Brake zone, Layers, Advanced). **Present** hides the panel and adds a strip with v(t) and the stopping results. Keys: Space play/pause · R reset · P present.

**Validation mode** (rail, tube, disc): uniform field, low Rm, no friction, no heating; the analytic curve is overlaid on the speed plot with the live % error, and the analytic stopping distance is shown next to the simulated one.

Code layout: `src/physics/` pure TS (no UI) · `src/render/` canvas drawing · `src/ui/` React panels · `scripts/check.ts` self-checks.

## Model, equation by equation

### 1. Motional EMF, Faraday, Lenz
ε = B·L·v ; Ohm's law in a moving conductor J = σ(E + v×B). Induced current opposes the change in flux (Lenz): J×B points against v.
EMF in the table: ε = B_gap · (pole height) · v.

### 2. Magnet model (`magnet.ts`)
Each magnet is a uniformly magnetised NdFeB cuboid (Br: N35 1.17 T, N42 1.30 T, N52 1.44 T). Closed-form surface-charge (Coulombian) field, M along y:

B_y = Br/(4π) · Σ_{i,j,k∈{1,2}} (−1)^{i+j+k} · atan( (x−x_i)(z−z_k) / ((y−y_j)·r_ijk) ), r_ijk = √((x−x_i)²+(y−y_j)²+(z−z_k)²)

Two facing rows (one on each side of the fin) with polarity alternating along x at pole pitch τp; all magnets are superposed. The steel U-channel is modelled by the **method of images** for μ_r → ∞: a block magnetised normal to the iron has an image of the same sign, so the effective thickness doubles. Electromagnet option: B = μ₀NI/g clamped at 1.6 T, with the block model's fringing shape.
Verified against the analytic on-axis formula to 1e-16.

### 3. 2D eddy-current solver (`solver.ts`) — replaces the old η fudge factor
Thin plate (default 0.5 × 0.2 m) on a 120 × 40 cell-centred grid in the x–z plane. Low magnetic Reynolds number:

- J = σ(−∇φ + v×B); only B_y matters for in-plane currents: J_x = −σ∂φ/∂x, J_z = σ(−∂φ/∂z + v B_y)
- ∇·J = 0 ⇒ ∇²φ = ∇·(v×B) = v ∂B_y/∂z, with J·n = 0 on plate edges and slot walls (Neumann)
- Finite volumes, face conductance 0 next to a slot cell; solved by **preconditioned conjugate gradients** (SSOR preconditioner, warm start). Plain SOR needed > 1000 sweeps for slotted plates and left a 2–4 % residual; PCG gives ≈ 1e-6.
- Force F = d·∬(J×B)dA, Joule power P = d·∬|J|²/σ dA. Because J ∝ v and σ factors out of φ, one solve with v = 1, σ̂ ∈ {0,1} gives K̂ = ∬ĵ_z B_y dA, P̂ = ∬|ĵ|² dA, and then **F = σ·d·K̂·B²·v**, **P = σ·d·P̂·B²·v²**. At convergence K̂ = P̂ exactly (follows from Σφ∇·J = 0), so the "P = F·v check" is a solver-residual test (≤ 2e-2 % in all scenarios, 1e-5 % typical).
- **Position dependence.** K̂(x) is precomputed on a grid of plate positions (3-cell step): an entry ramp, one periodic interior period for a long array, and the exit by mirror symmetry. The result is the real entry/exit ramp, replacing the old tanh guess. It is computed **once per geometry in a Web Worker** (1.7 s solid, 3–5 s slotted on a laptop) and cached; material, Br, mass, speed only rescale it. **The solver never runs per frame.**
- **Slotted fins:** slot cells have σ = 0; sliders for slot count (up to 12) and depth.
- **Visualisation:** |J| heat-map (grey → cool accent) and streamlines = contours of the stream function ψ (J = ∇×(ψ ŷ)), taken from the cached solution for the current plate position. They show the counter-rotating vortices at each pole edge.
- Verified: infinite uniform strip gives K̂ = 5e-14 (no net force, as it must); grid convergence 1.0 % (60×20), 0.18 % (120×40) vs 240×80.

### 4. Dynamics (`lanes.ts`)
Classical **RK4**, Δt = 1 ms. The energy bookkeeping (plate heat, rolling loss, temperature) is part of the state vector, so conservation is checked by the integrator itself: KE (+PE) + Q_plate + Q_loss = E₀, error ≤ 2e-9 relative in all scenarios.
- Rail: m v̇ = −F_eddy − F_friction − F_roll, F_roll = C_rr m g tanh(v/ε).
- F = k v, k = σ(T)·d_eff·K̂(x)·B²·G(v). Without saturation v(t) = v₀e^(−t/τ), τ = m/k, x_stop = m v₀/k.
- No holding force: F → 0 as v → 0.

### 5. High-speed regime (`regime.ts`) — replaces the 6 mm cap
With alternating poles the plate sees ω = π v/τp, skin depth δ = √(2/(μ₀σω)).
Effective conducting thickness d_eff = δ·tanh(d/δ); Reitz thin-sheet factor G = 1/(1+(v/w)²), w = 2/(μ₀σ d_eff).
**Why:** it reproduces both asymptotes — thin sheet F ∝ 1/v (Reitz) and thick plate F ∝ v^(−1/2) — without solving the diffusion equation across the thickness. Rm = μ₀σ v d shown live: < 0.2 low-speed linear, 0.2–2 transition, > 2 high-speed. The F(v) plot labels the theoretical peak (near v ≈ w).

### 6. Joule heating and brake fade
C·dT/dt = F·v − hA(T − T_amb), C = ρ c_p V (V reduced by the slot mask); σ(T) = σ₂₀/(1 + α(T − 20 °C)); h = 25 W/m²K.
**Friction brake lane:** constant force F (from "Match by", or μ_k·N with μ_k 0.30–0.50 and the clamp slider), heating a cast-iron disc and a pad pair (see "Fair eddy vs friction comparison").

### 7. Lenz tube (`lanes.ts`, TubeLane)
Dipole p = Br·V/μ₀ on the axis of a thin pipe (mean radius a, wall w). Ring flux Φ(z) = μ₀ p a² / (2(a²+z²)^{3/2}); ε = v dΦ/dz; J = σε/(2πa); P = ∫J²/σ dV with dV = 2πa w dz and ∫z²/(a²+z²)⁵dz = 5π/(128a⁷), giving
**P = (45/1024) μ₀² p² σ w v² / a⁴ ⇒ F = k v, k = (45/1024) μ₀² p² σ w / a⁴, v_t = m g / k.** Quadratic air drag is included for the free-fall lane. Derivation shown in the Theory drawer.
Default: 12 mm N42 sphere (6.8 g) in a 15 mm OD, 1 mm wall copper pipe → v_t ≈ 4.5 cm/s. The point-dipole model under-estimates the drag when the magnet radius is comparable to the pipe radius, so measured terminal speeds are usually lower.

### 8. Waltenhofen pendulum
θ'' = −(g/L) sin θ − (k(x)/m) θ', with x = L sin θ the plate position relative to the magnets and k(x) from the same 2D solver table (solid vs slotted). Torque = F·L, I = mL². Energy check: m g L(1−cos θ) + ½mL²θ'² + Q = E₀.

### 9. Rotating disc
I dω/dt = −k r_m² ω (k from the solver at the centred-magnet position; a straight patch of the rim stands for the arc), I = ½MR².

## Assumptions and limitations
- Low-Rm Poisson model; the eddy reaction field enters only via the d_eff/Reitz correction, not self-consistently.
- Thin plate: B_y at the mid-plane, no J_y; field uniform across the thickness.
- Steel U-channel: infinite permeability, no saturation, no leakage; fins are non-ferromagnetic (no attraction force).
- Lumped plate temperature, σ(T) uniform over the plate.
- Pendulum: the plate translates through the gap (rotation neglected). Disc: straight patch for the arc.
- Tube: point dipole, thin wall, no tilt or eccentricity.
- Drawing is to scale (scale bars); the plan-section inset magnifies the gap direction ×10 (labelled).

## Sources
- Y. Levin, F. L. da Silveira, F. B. Rizzato, *Electromagnetic braking: A simple quantitative model*, Am. J. Phys. **74**, 815 (2006) — falling magnet.
- J. R. Reitz, *Forces on moving magnets due to eddy currents*, J. Appl. Phys. **41**, 2067 (1970) — thin-sheet saturation.
- J. H. Wouterse, *Critical torque and speed of eddy current brake with widely separated soft iron poles*, IEE Proc. B **138**, 153 (1991).
- Z. J. Yang et al., Supercond. Sci. Technol. **3**, 591 (1990); R. Engel-Herbert, T. Hesjedal, J. Appl. Phys. **97**, 074504 (2005) — cuboid field.
- Waltenhofen's pendulum (19th-century demonstration of eddy-current damping in slotted vs solid plates).

(Please double-check the page numbers against the originals before citing them in the report.)

## Self-checks (`npm run check`)
Fair comparison: x_eddy / x_friction = 2/(1 + v_stop/v₀) ≈ 2 in validation conditions (three vehicle sizes) · each Match-by rule does what it says (equal peak force, equal stopping distance) · both lanes end with identical heat totals (< 1 % of E₀) · equal m·c gives the same ΔT in disc, pad and fin · ΔT = E/(m·c) vs the measured rise.
'Until stop': every rail preset (all comparison modes × 4 vehicle/magnet variants) reaches v < 0.01 m/s inside the zone · cuboid field vs analytic · infinite-strip zero force · K̂ = P̂ residual · grid convergence · slots reduce force · energy conservation and P = F·v in every scenario · friction brake stops · validation mode vs the analytic exponential (rail, tube, disc).

## Demo URL switches
`?scenario=rail|tube|pendulum|disc` · `&mode=…` · `&zone=finite` · `&validation=1` · `&seek=3` (fast-forward to t = 3 s) · `&pause=1` · `&panel=0` · `&present=1` · `&theory=1` · `&layers=heat,labels,…` · `&match=peak-force|stop-distance|manual` · `&thermal=equal`
