import { useRef, useState } from "react";

/**
 * 液态玻璃表面（iOS 风格）：鼠标掠过时高光跟随（specular sheen），
 * 按下时在玻璃上激起一圈涟漪。仅 transform/opacity，符合性能守则；
 * prefers-reduced-motion 下涟漪关闭。
 */
export function GlassSurface({
  className, children, ...rest
}: {
  className: string;
  children: React.ReactNode;
} & React.HTMLAttributes<HTMLDivElement>) {
  const ref = useRef<HTMLDivElement>(null);
  const seq = useRef(0);
  const [ripples, setRipples] = useState<{ id: number; x: number; y: number }[]>([]);
  const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  return (
    <div
      ref={ref}
      className={`${className} glass-surface`}
      onPointerMove={(e) => {
        const el = ref.current; if (!el) return;
        const r = el.getBoundingClientRect();
        el.style.setProperty("--mx", `${e.clientX - r.left}px`);
        el.style.setProperty("--my", `${e.clientY - r.top}px`);
      }}
      onPointerDown={(e) => {
        if (reduced) return;
        const el = ref.current; if (!el) return;
        const r = el.getBoundingClientRect();
        const id = ++seq.current;
        setRipples((rs) => [...rs.slice(-4), { id, x: e.clientX - r.left, y: e.clientY - r.top }]);
        setTimeout(() => setRipples((rs) => rs.filter((x) => x.id !== id)), 700);
      }}
      {...rest}
    >
      <div className="sheen" aria-hidden />
      {ripples.map((rp) => (
        <span key={rp.id} className="ripple" style={{ left: rp.x, top: rp.y }} aria-hidden />
      ))}
      {children}
    </div>
  );
}
