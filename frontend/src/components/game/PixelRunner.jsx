export default function PixelRunner() {
  return <svg className="pixel-runner-art" viewBox="0 0 260 240" role="img" aria-label="Pixel-art runner character">
    <defs><pattern id="pixelGrid" width="13" height="13" patternUnits="userSpaceOnUse"><path d="M13 0H0V13" fill="none" stroke="#fffdf6" strokeOpacity=".11" strokeWidth="1" /></pattern></defs>
    <rect x="18" y="11" width="224" height="211" rx="3" fill="#e8a75c" /><rect x="18" y="11" width="224" height="211" rx="3" fill="url(#pixelGrid)" />
    <circle cx="190" cy="53" r="20" fill="#f4d68e" /><path d="M35 162h26v-13h13v-13h13v26h13v-13h13v13h13v-26h13v26h13v-13h13v26h39v48H35z" fill="#cf7545" opacity=".6" />
    <g shapeRendering="crispEdges" transform="translate(69 46)">
      <rect x="49" y="0" width="52" height="13" fill="#263b32" /><rect x="36" y="13" width="78" height="13" fill="#263b32" />
      <rect x="23" y="26" width="91" height="39" fill="#f4efe0" /><rect x="10" y="39" width="52" height="39" fill="#263b32" />
      <rect x="49" y="26" width="52" height="13" fill="#263b32" /><rect x="62" y="39" width="13" height="13" fill="#263b32" />
      <rect x="23" y="78" width="78" height="13" fill="#263b32" /><rect x="23" y="91" width="26" height="13" fill="#263b32" /><rect x="75" y="91" width="26" height="13" fill="#263b32" />
      <rect x="10" y="65" width="13" height="26" fill="#f4efe0" /><rect x="88" y="65" width="13" height="26" fill="#f4efe0" />
      <rect x="23" y="104" width="26" height="13" fill="#263b32" /><rect x="75" y="104" width="26" height="13" fill="#263b32" />
      <rect x="10" y="117" width="39" height="13" fill="#263b32" /><rect x="75" y="117" width="39" height="13" fill="#263b32" />
      <rect x="10" y="130" width="13" height="13" fill="#f4efe0" /><rect x="101" y="130" width="13" height="13" fill="#f4efe0" />
    </g>
    <rect x="31" y="197" width="40" height="5" fill="#f7d9a0" /><rect x="82" y="197" width="13" height="5" fill="#f7d9a0" /><rect x="111" y="197" width="39" height="5" fill="#f7d9a0" />
  </svg>;
}