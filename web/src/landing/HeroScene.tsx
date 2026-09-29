// The 3D hero: Claude on the left (rate-limited), ChatGPT on the right, Baton in the middle.
// The baton travels from one model, through Baton, to the next. Loaded lazily; no network assets.
import { useMemo, useRef, type ReactNode, type RefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, Float, Lightformer, Line } from "@react-three/drei";
import * as THREE from "three";

const CYAN = "#38BDF8";
const VIOLET = "#A78BFA";
const FUCHSIA = "#E879F9";
const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function useGlowTexture() {
  return useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d")!;
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, "rgba(255,255,255,1)");
    grd.addColorStop(0.25, "rgba(255,255,255,0.45)");
    grd.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }, []);
}

/** The baton's gradient, cyan -> violet -> fuchsia along its length, unlit so it glows. */
function useBatonMaterial() {
  return useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          a: { value: new THREE.Color(CYAN) },
          b: { value: new THREE.Color(VIOLET) },
          c: { value: new THREE.Color(FUCHSIA) },
        },
        vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
        fragmentShader:
          "uniform vec3 a; uniform vec3 b; uniform vec3 c; varying vec2 vUv;" +
          "void main(){ float t = vUv.y; vec3 col = t < 0.5 ? mix(a, b, t * 2.0) : mix(b, c, (t - 0.5) * 2.0); gl_FragColor = vec4(col * 1.35, 1.0); }",
        toneMapped: false,
      }),
    [],
  );
}

function Glow({ color, scale, opacity = 0.55 }: { color: string; scale: number; opacity?: number }) {
  const map = useGlowTexture();
  return (
    <sprite scale={[scale, scale, 1]}>
      <spriteMaterial map={map} color={color} transparent opacity={opacity} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
    </sprite>
  );
}

function Orb({ position, color, name }: { position: [number, number, number]; color: string; name: string }) {
  const core = useRef<THREE.Mesh>(null);
  const bright = useMemo(() => new THREE.Color(color).multiplyScalar(1.6), [color]);
  useFrame(({ clock }) => {
    core.current?.scale.setScalar(1 + Math.sin(clock.elapsedTime * 2 + position[0]) * 0.06);
  });
  return (
    <group position={position}>
      <Float speed={1.3} rotationIntensity={0.25} floatIntensity={0.5}>
        <mesh>
          <sphereGeometry args={[0.95, 64, 64]} />
          <meshPhysicalMaterial
            transmission={1} roughness={0.08} thickness={1.4} ior={1.35} clearcoat={1} clearcoatRoughness={0.1}
            color={color} attenuationColor={color} attenuationDistance={2.2} envMapIntensity={1.4} transparent
          />
        </mesh>
        <mesh ref={core}>
          <icosahedronGeometry args={[0.38, 2]} />
          <meshBasicMaterial color={bright} toneMapped={false} wireframe />
        </mesh>
        <Glow color={color} scale={2.6} opacity={0.35} />
        <pointLight color={color} intensity={8} distance={4} />
      </Float>
      <group position={[0, -1.55, 0]} userData={{ anchor: name }} />
    </group>
  );
}

function Core() {
  const ringA = useRef<THREE.Mesh>(null);
  const ringB = useRef<THREE.Mesh>(null);
  const baton = useRef<THREE.Mesh>(null);
  const mat = useBatonMaterial();
  useFrame((_, d) => {
    if (ringA.current) { ringA.current.rotation.x += d * 0.45; ringA.current.rotation.y += d * 0.6; }
    if (ringB.current) { ringB.current.rotation.y -= d * 0.5; ringB.current.rotation.z += d * 0.35; }
    if (baton.current) baton.current.rotation.y += d * 1.1;
  });
  return (
    <group>
      <Float speed={1.6} rotationIntensity={0.3} floatIntensity={0.35}>
        <mesh ref={ringA}>
          <torusGeometry args={[1.02, 0.03, 16, 160]} />
          <meshBasicMaterial color={new THREE.Color(VIOLET).multiplyScalar(1.5)} toneMapped={false} />
        </mesh>
        <mesh ref={ringB}>
          <torusGeometry args={[1.26, 0.014, 16, 160]} />
          <meshBasicMaterial color={CYAN} transparent opacity={0.7} toneMapped={false} />
        </mesh>
        <group rotation={[0, 0, -0.62]}>
          <mesh ref={baton} material={mat}>
            <capsuleGeometry args={[0.15, 1.05, 8, 32]} />
          </mesh>
        </group>
        <Glow color={VIOLET} scale={3.4} opacity={0.5} />
      </Float>
      <group position={[0, -1.75, 0]} userData={{ anchor: "Baton" }} />
    </group>
  );
}

/** The path the baton runs, the runner itself, and particles flowing along it. */
function Relay() {
  const curve = useMemo(
    () => new THREE.CatmullRomCurve3([v3(-3.4, 0, 0), v3(-1.8, 1.05, 0.5), v3(0, 0, 0), v3(1.8, 1.05, 0.5), v3(3.4, 0, 0)]),
    [],
  );
  const points = useMemo(() => curve.getPoints(160), [curve]);
  const mat = useBatonMaterial();
  const runner = useRef<THREE.Group>(null);
  const dots = useRef<THREE.Points>(null);
  const N = 70;
  const seeds = useMemo(() => Array.from({ length: N }, () => [Math.random(), (Math.random() - 0.5) * 0.12, (Math.random() - 0.5) * 0.12]), []);
  const positions = useMemo(() => new Float32Array(N * 3), []);
  const tmp = useMemo(() => new THREE.Vector3(), []);
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), []);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const u = (t * 0.16) % 1;
    if (runner.current) {
      curve.getPointAt(u, runner.current.position);
      const tan = curve.getTangentAt(u);
      runner.current.quaternion.setFromUnitVectors(up, tan);
      const s = 1 + Math.max(0, 1 - Math.abs(u - 0.5) * 6) * 0.6; // swells as it passes through Baton
      runner.current.scale.setScalar(s);
    }
    if (dots.current) {
      for (let i = 0; i < N; i++) {
        const [o, jx, jy] = seeds[i];
        curve.getPointAt((o + t * 0.05) % 1, tmp);
        positions[i * 3] = tmp.x + jx;
        positions[i * 3 + 1] = tmp.y + jy;
        positions[i * 3 + 2] = tmp.z;
      }
      dots.current.geometry.attributes.position.needsUpdate = true;
    }
  });

  return (
    <group>
      <Line points={points} color={VIOLET} lineWidth={1.2} dashed dashSize={0.1} gapSize={0.08} transparent opacity={0.5} />
      <points ref={dots}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        </bufferGeometry>
        <pointsMaterial size={0.045} color={VIOLET} transparent opacity={0.85} blending={THREE.AdditiveBlending} depthWrite={false} sizeAttenuation />
      </points>
      <group ref={runner}>
        <mesh material={mat}>
          <capsuleGeometry args={[0.07, 0.36, 6, 16]} />
        </mesh>
        <Glow color={FUCHSIA} scale={0.9} opacity={0.7} />
      </group>
    </group>
  );
}


const LABELS = [
  { name: "Claude", caption: "429 · rate-limited", tone: "#FBBF24" },
  { name: "Baton", caption: "contract · verify · repair", tone: VIOLET },
  { name: "ChatGPT", caption: "continues the task", tone: "#34D399" },
];

/** Each frame, put the DOM labels under their 3D anchors. */
function Anchors({ refs }: { refs: RefObject<(HTMLDivElement | null)[]> }) {
  const { scene, camera, size } = useThree();
  const p = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    scene.traverse((o) => {
      const name = o.userData.anchor as string | undefined;
      if (!name) return;
      const el = refs.current?.[LABELS.findIndex((l) => l.name === name)];
      if (!el) return;
      o.getWorldPosition(p).project(camera);
      el.style.transform = `translate(-50%, 0) translate(${((p.x + 1) / 2) * size.width}px, ${((1 - p.y) / 2) * size.height}px)`;
      el.style.opacity = "1";
    });
  });
  return null;
}

/** Tilts toward the pointer, and shrinks the scene to fit narrow screens. */
function Rig({ children }: { children: ReactNode }) {
  const g = useRef<THREE.Group>(null);
  const { viewport } = useThree();
  const s = Math.min(1, viewport.width / 9.2);
  useFrame(({ pointer }) => {
    if (!g.current) return;
    g.current.rotation.y = THREE.MathUtils.lerp(g.current.rotation.y, pointer.x * 0.28, 0.05);
    g.current.rotation.x = THREE.MathUtils.lerp(g.current.rotation.x, -pointer.y * 0.14, 0.05);
  });
  return <group ref={g} scale={s}>{children}</group>;
}

export default function HeroScene({ still = false }: { still?: boolean }) {
  const labels = useRef<(HTMLDivElement | null)[]>([]);
  return (
    <div className="relative h-full w-full">
    <Canvas
      camera={{ position: [0, 0.35, 9], fov: 35 }}
      dpr={[1, 2]}
      gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
      frameloop={still ? "demand" : "always"}
      aria-label="Claude hits a rate limit; Baton carries the task to ChatGPT"
      role="img"
    >
      <ambientLight intensity={0.35} />
      <directionalLight position={[3, 5, 4]} intensity={1.2} />
      <Environment resolution={256}>
        <Lightformer form="ring" intensity={3} color={VIOLET} position={[0, 4, -6]} scale={6} />
        <Lightformer intensity={2.2} color={CYAN} position={[-6, 1, 2]} scale={[4, 6, 1]} />
        <Lightformer intensity={2.2} color={FUCHSIA} position={[6, 1, 2]} scale={[4, 6, 1]} />
        <Lightformer intensity={0.8} position={[0, -4, 4]} scale={[10, 2, 1]} />
      </Environment>
      <Rig>
        <Orb position={[-3.4, 0, 0]} color={CYAN} name="Claude" />
        <Core />
        <Orb position={[3.4, 0, 0]} color={FUCHSIA} name="ChatGPT" />
        <Relay />
      </Rig>
      <Anchors refs={labels} />
    </Canvas>
      {LABELS.map((l, i) => (
        <div key={l.name} ref={(el) => { labels.current[i] = el; }} aria-hidden
          className="pointer-events-none absolute left-0 top-0 select-none whitespace-nowrap text-center opacity-0 transition-opacity duration-500">
          <div className="font-display text-[22px] leading-none text-fg">{l.name}</div>
          <div className="mt-1 font-mono text-[10.5px] uppercase tracking-[0.14em]" style={{ color: l.tone }}>{l.caption}</div>
        </div>
      ))}
    </div>
  );
}
