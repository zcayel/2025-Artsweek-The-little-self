import { engine, Animator, AudioSource, GltfContainer, Transform } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import type { Entity } from '@dcl/sdk/ecs'

const WIND_CLIP = 'wind'
const TERRAIN = 'the_little_self'
const BGM = 'assets/scene/Audio/birds-wind-and-synth-v2.ogg'
const BGM_VOLUME = 0.78
const SPLASH = 'assets/scene/Audio/wave_02_cc0-11505__transitking__wavesound.mp3'

// Background music. `global: true` plays at constant volume anywhere in the
// scene - the birds/wind ambience is attached to the terrain entity and fades
// with distance, which is right for ambience but wrong for music.
function startBgm(): void {
  const e = engine.addEntity()
  Transform.create(e, { position: Vector3.create(0, 0, 0) })
  AudioSource.create(e, {
    audioClipUrl: BGM,
    playing: true,
    loop: true,
    global: true,
    volume: BGM_VOLUME
  })
  console.log('[bgm] started', BGM, 'volume', BGM_VOLUME)
}

// --- pond splash -----------------------------------------------------------
// The pond entity IS the trigger area. Rather than hardcoding coordinates, the
// pond entities are found at runtime by their GltfContainer src and the emitter
// is attached directly to each one, so the sound always comes from the water.
// pond.glb's mesh spans x -3.08..2.81, z -3.68..5.45 around its own origin.
const POND_OFF_X = -0.135
const POND_OFF_Z = 0.885
const POND_HX = 3.2
const POND_HZ = 4.8
const POND_HY = 4.0

type Pond = { entity: Entity; cx: number; cy: number; cz: number; inside: boolean }
const PONDS: Pond[] = []

// These are the entity names shown in Creator Hub, and the ones Creator Hub
// generates into assets/scene/entity-names.ts.
const POND_NAMES = ['pond.glb_2', 'pond.glb_2_3']

function addPond(entity: Entity, how: string): void {
  for (const p of PONDS) {
    if (p.entity === entity) return
  }
  const t = Transform.getOrNull(entity)
  if (!t) return
  // emitter lives on the pond itself, so the splash comes from the water
  AudioSource.createOrReplace(entity, {
    audioClipUrl: SPLASH,
    playing: false,
    loop: false,
    volume: 1
  })
  const p: Pond = {
    entity,
    cx: t.position.x + POND_OFF_X,
    cy: t.position.y,
    cz: t.position.z + POND_OFF_Z,
    inside: false
  }
  PONDS.push(p)
  console.log('[splash] pond', entity, 'via', how,
    '-> box centre', p.cx.toFixed(2), p.cy.toFixed(2), p.cz.toFixed(2),
    'half-extents', POND_HX, POND_HY, POND_HZ)
}

function findPonds(): void {
  // by the name Creator Hub shows
  for (const name of POND_NAMES) {
    const e = engine.getEntityOrNullByName(name)
    if (e) addPond(e, `name "${name}"`)
  }
  // fallback: anything loading pond.glb
  if (PONDS.length === 0) {
    for (const [entity, gltf] of engine.getEntitiesWith(GltfContainer)) {
      if (gltf.src.indexOf('pond') !== -1) addPond(entity, 'src ' + gltf.src)
    }
  }
  if (PONDS.length > 0) console.log('[splash] ponds found:', PONDS.length)
}

let report = 0

function splashSystem(dt: number): void {
  if (PONDS.length === 0) return
  const p = Transform.getOrNull(engine.PlayerEntity)
  if (!p) {
    report += dt
    if (report > 3) {
      report = 0
      console.log('[splash] no player transform yet')
    }
    return
  }

  // periodic heartbeat so a miss is diagnosable from the console
  report += dt
  const shout = report > 3
  if (shout) report = 0

  for (const pond of PONDS) {
    const dx = Math.abs(p.position.x - pond.cx)
    const dy = Math.abs(p.position.y - pond.cy)
    const dz = Math.abs(p.position.z - pond.cz)
    const hit = dx < POND_HX && dz < POND_HZ && dy < POND_HY
    if (shout) {
      console.log('[splash] player', p.position.x.toFixed(1), p.position.y.toFixed(1),
        p.position.z.toFixed(1), '| pond', pond.entity,
        'dx', dx.toFixed(1), 'dy', dy.toFixed(1), 'dz', dz.toFixed(1),
        'inside', hit)
    }
    if (hit === pond.inside) continue
    pond.inside = hit
    // toggling `playing` off on exit is what re-arms the one-shot
    AudioSource.getMutable(pond.entity).playing = hit
    console.log('[splash]', hit ? 'ENTER -> play' : 'exit -> rearm', 'pond', pond.entity)
  }
}

// The 'wind' clip lives inside the_little_self.glb. The Animator state that
// starts it was set in main.composite, but main.crdt (which the runtime also
// loads) predates that edit, so the clip may never be triggered. Start it from
// code instead - that works regardless of which scene file wins.
function startWind(): boolean {
  for (const [entity, gltf] of engine.getEntitiesWith(GltfContainer)) {
    if (gltf.src.indexOf(TERRAIN) === -1) continue
    Animator.createOrReplace(entity, {
      states: [
        { clip: WIND_CLIP, playing: true, loop: true, weight: 1, speed: 1 }
      ]
    })
    Animator.playSingleAnimation(entity, WIND_CLIP, false)
    console.log('[wind] started clip on entity', entity, gltf.src)
    return true
  }
  return false
}

export function main() {
  startBgm()
  engine.addSystem(splashSystem, 0, 'pond-splash')

  // Composite entities may not exist on the very first frame, so keep looking
  // until both the ponds and the terrain have turned up.
  let waited = 0
  let windOn = startWind()
  let pondsOn = false
  engine.addSystem(
    (dt: number) => {
      waited += dt
      if (!pondsOn) {
        findPonds()
        if (PONDS.length > 0) pondsOn = true
      }
      if (!windOn) windOn = startWind()
      if ((windOn && pondsOn) || waited > 30) {
        console.log('[boot] done. wind:', windOn, 'ponds:', PONDS.length)
        engine.removeSystem('boot')
      }
    },
    0,
    'boot'
  )
}
