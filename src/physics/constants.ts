/**
 * Physical constants and material data (SI units).
 * Values are room-temperature (20 °C) textbook figures.
 */

export const MU0 = 4 * Math.PI * 1e-7 // vacuum permeability [H/m]
export const G = 9.81 // gravitational acceleration [m/s²]
export const T_REF = 20 // reference temperature for σ and α [°C]
export const T_AMBIENT = 25 // starting / surrounding temperature [°C]
export const H_CONV = 25 // convective heat-transfer coefficient, still air [W/(m²·K)]
export const CRR = 0.002 // rolling-resistance coefficient, steel wheel on steel rail
export const B_SAT_IRON = 1.6 // electromagnet pole-iron saturation [T]

export interface Material {
  id: string
  name: string
  /** electrical conductivity at 20 °C [S/m] */
  sigma: number
  /** density [kg/m³] */
  rho: number
  /** specific heat capacity [J/(kg·K)] */
  cp: number
  /** temperature coefficient of resistivity [1/K]:  ρ(T) = ρ20·(1 + α(T − 20)) */
  alpha: number
  /** display tint of the metal (greyscale-ish, copper warm, aluminium cool) */
  tint: [number, number, number]
}

export const MATERIALS: Material[] = [
  { id: 'cu', name: 'Copper', sigma: 5.96e7, rho: 8960, cp: 385, alpha: 0.0039, tint: [150, 104, 78] },
  { id: 'al', name: 'Aluminium', sigma: 3.5e7, rho: 2700, cp: 897, alpha: 0.0039, tint: [150, 156, 164] },
  { id: 'brass', name: 'Brass', sigma: 1.5e7, rho: 8500, cp: 380, alpha: 0.0015, tint: [140, 124, 84] },
  { id: 'ss', name: 'Stainless steel', sigma: 1.4e6, rho: 8000, cp: 500, alpha: 0.00094, tint: [124, 128, 132] },
  { id: 'plastic', name: 'PVC / plastic (insulator)', sigma: 1e-12, rho: 1400, cp: 1000, alpha: 0, tint: [92, 92, 96] },
]
export const materialById = (id: string): Material => MATERIALS.find((m) => m.id === id) ?? MATERIALS[0]

/** NdFeB sintered magnet grades: remanence Br [T] and density [kg/m³]. */
export const GRADES = [
  { id: 'N35', name: 'N35', Br: 1.17 },
  { id: 'N42', name: 'N42', Br: 1.3 },
  { id: 'N52', name: 'N52', Br: 1.44 },
]
export const gradeById = (id: string) => GRADES.find((g) => g.id === id) ?? GRADES[1]
export const RHO_NDFEB = 7500

/**
 * Friction brake hardware (typical engineering figures, to be checked before citing):
 * a ventilated cast-iron disc sized as a fraction of the vehicle mass (a ~8 kg front disc per
 * wheel on a 1500 kg car is ~1.6 % of the car per disc set), and a semi-metallic pad pair.
 */
export const BRAKE_DISC = { rho: 7100, cp: 460, k: 52 /* W/(m·K) */, massFrac: 0.016, minMass: 1.5 /* kg */, areaPerKg: 0.03 /* m² cooled per kg */ }
export const BRAKE_PAD = { rho: 2500, cp: 1000, k: 2 /* W/(m·K) */, massRatio: 0.04 /* pad mass / disc mass */ }

/**
 * Heat partition at a sliding contact between two semi-infinite bodies (Charron): the fraction
 * going into the disc is e_d/(e_d + e_p) with thermal effusivity e = √(k ρ c).
 */
export const discHeatShare = () => {
  const ed = Math.sqrt(BRAKE_DISC.k * BRAKE_DISC.rho * BRAKE_DISC.cp)
  const ep = Math.sqrt(BRAKE_PAD.k * BRAKE_PAD.rho * BRAKE_PAD.cp)
  return ed / (ed + ep)
}
