/*
 * Logo de Mesagri: el dibujo del documento de diseño (A-00) — el agricultor con sombrero, la fuente
 * con la cosecha, el tenedor y la cuchara —, el nombre y el lema «Del campo a tu mesa».
 * El dibujo es un SVG (public/brand/mesagri-mark.svg) que se pinta con el color del texto.
 */
import type { CSSProperties } from 'react';

/** Solo el dibujo. `size` es el alto. */
export function Mark({ size, color, label, style }: { size?: string | number; color?: string; label?: string; style?: CSSProperties }) {
  const h = size === undefined ? undefined : typeof size === 'number' ? `${size}px` : size;
  return (
    <span
      className="mark"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{ ...(h ? { height: h } : {}), ...(color ? { color } : {}), ...style }}
    />
  );
}

/** Dibujo, nombre y lema, centrados (inicio, bienvenida e ingreso). */
export function Logo({ big, light, tagline = true }: { big?: boolean; light?: boolean; tagline?: boolean }) {
  return (
    <div className={'logo' + (big ? ' big' : '') + (light ? ' on-light' : '')} role="img" aria-label="Mesagri · Del campo a tu mesa">
      <Mark />
      <b aria-hidden="true">Mesagri</b>
      {tagline && <i aria-hidden="true">Del campo a tu mesa</i>}
    </div>
  );
}

/** Marca en línea para barras y menús: dibujo pequeño con el nombre al lado. */
export function BrandRow({ sub, size = 40 }: { sub?: string; size?: number }) {
  return (
    <span className="brandrow">
      <Mark size={size} />
      <span className="brandtxt"><b>Mesagri</b>{sub && <small>{sub}</small>}</span>
    </span>
  );
}
