import React from 'react';

export type LogoVariant = 'web' | 'admin' | 'crema' | 'isotipo' | 'isotipo-blanco';

interface RepartoYaLogoProps {
  variant?: LogoVariant;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  showText?: boolean;
  compact?: boolean; // sin líneas de velocidad para tamaños pequeños (<48px)
  className?: string;
  imgFallback?: boolean;
}

export const RepartoYaLogo: React.FC<RepartoYaLogoProps> = ({
  variant = 'web',
  size = 'md',
  showText = true,
  compact = false,
  className = '',
  imgFallback = false,
}) => {
  // Dimensiones proporcionales según tamaño
  const heights = {
    xs: 24,
    sm: 32,
    md: 40,
    lg: 56,
    xl: 72,
  };

  const currentHeight = heights[size] || heights.md;
  const isCompact = compact || currentHeight < 40;

  // Si se solicita imagen PNG directa
  if (imgFallback) {
    if (variant === 'admin') {
      return (
        <div className={`flex items-center gap-2.5 ${className}`}>
          <img
            src="/marca/logo-admin-transparent.png"
            alt="RepartoYA"
            style={{ height: `${currentHeight}px` }}
            className="object-contain"
          />
        </div>
      );
    }
    return (
      <div className={`flex items-center gap-2.5 ${className}`}>
        <img
          src="/marca/logo-web.png"
          alt="RepartoYA"
          style={{ height: `${currentHeight}px` }}
          className="object-contain"
        />
      </div>
    );
  }

  // Colores según variante
  const isDarkBg = variant === 'admin' || variant === 'isotipo-blanco';
  const colorAzul = '#123C6B';
  const colorNaranja = '#F4661B';
  const colorBlanco = '#FFFFFF';

  // Configuración de partes del camión:
  // Caja:
  // - En 'web' o 'crema': caja Azul Ruta (#123C6B)
  // - En 'admin': caja Blanca (#FFFFFF)
  const boxFill = isDarkBg ? colorBlanco : colorAzul;
  // Letras YA en la caja: siempre Naranja YA (#F4661B)
  const textYaBoxFill = colorNaranja;
  // Cabina: siempre Naranja YA (#F4661B)
  const cabinaFill = colorNaranja;
  // Ventana: Blanca en web, Azul o Blanca según contraste
  const windowFill = colorBlanco;
  // Ruedas:
  const wheelOuter = isDarkBg ? colorBlanco : colorAzul;
  const wheelInner = isDarkBg ? colorAzul : colorBlanco;
  // Líneas de velocidad:
  const linesFill = colorNaranja;

  // Tipografía del texto RepartoYA:
  const textRepartoFill = isDarkBg ? colorBlanco : colorAzul;
  const textYaBrandFill = colorNaranja;

  return (
    <div className={`inline-flex items-center gap-2.5 select-none ${className}`}>
      {/* SVG Vectorial Isotipo */}
      <svg
        viewBox="0 0 110 56"
        height={currentHeight}
        className="shrink-0 overflow-visible"
        aria-hidden="true"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Líneas de velocidad (solo si no es compact) */}
        {!isCompact && (
          <g fill={linesFill}>
            <rect x="2" y="19" width="10" height="3" rx="1.5" />
            <rect x="0" y="27" width="13" height="3" rx="1.5" />
            <rect x="3" y="35" width="9" height="3" rx="1.5" />
          </g>
        )}

        {/* Caja del camión */}
        <rect
          x="18"
          y="10"
          width="50"
          height="32"
          rx="5"
          fill={boxFill}
        />

        {/* Letras "YA" en la caja */}
        <text
          x="42"
          y="31"
          fill={textYaBoxFill}
          fontSize="17"
          fontWeight="900"
          fontFamily="system-ui, -apple-system, sans-serif"
          letterSpacing="0.5"
          textAnchor="middle"
        >
          YA
        </text>

        {/* Cabina del camión */}
        <path
          d="M68 18 H80 C83 18, 86 20, 89 24 L96 33 C97.5 35, 98 37, 98 39 V42 H68 V18 Z"
          fill={cabinaFill}
        />

        {/* Ventana de la cabina */}
        <path
          d="M72 22 H79 C81 22, 83 23, 85 26 L89 32 H72 V22 Z"
          fill={windowFill}
        />

        {/* Rueda trasera */}
        <circle cx="34" cy="42" r="7" fill={wheelOuter} />
        <circle cx="34" cy="42" r="3" fill={wheelInner} />

        {/* Rueda delantera */}
        <circle cx="82" cy="42" r="7" fill={wheelOuter} />
        <circle cx="82" cy="42" r="3" fill={wheelInner} />
      </svg>

      {/* Wordmark RepartoYA */}
      {showText && variant !== 'isotipo' && variant !== 'isotipo-blanco' && (
        <span
          className="font-extrabold tracking-tight leading-none"
          style={{ fontSize: `${Math.round(currentHeight * 0.72)}px` }}
        >
          <span style={{ color: textRepartoFill }}>Reparto</span>
          <span style={{ color: textYaBrandFill }}>YA</span>
        </span>
      )}
    </div>
  );
};
