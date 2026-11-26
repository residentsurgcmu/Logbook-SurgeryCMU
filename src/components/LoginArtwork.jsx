import React from "react";
import { METAL, suturePose } from "../loginSuture.mjs";

export default function LoginArtwork({ theme }) {
  if (theme === "horizon") return <svg aria-hidden="true" focusable="false" viewBox="0 0 600 300" fill="none">
    <defs>
    <clipPath id="sky">
    <rect width="600" height="300"/>
    </clipPath>
    </defs>
    <g clipPath="url(#sky)">
    <g className="sun">
    <circle cx="412" cy="114" r="48" fill="#c8a4ce"/>
    <circle cx="412" cy="114" r="56" stroke="#c8a4ce" strokeOpacity=".5" strokeDasharray="1.2 5"/>
    </g>
    <path d="M0 206Q63 189 113 178T191 152Q213 145 237 154T294 132Q331 101 359 103T421 108Q458 97 476 99T551 72Q574 58 600 61V300H0Z" fill="#789c84"/>
    <path d="M0 224Q40 203 86 200T172 179Q207 165 231 172T315 152Q349 132 378 140T469 127Q514 114 535 125T600 111V300H0Z" fill="#427f65"/>
    <path className="ridge-layer" d="M0 245Q30 230 72 226T170 207Q218 188 247 202T324 183Q361 165 389 176T460 162Q512 137 539 151T600 139V300H0Z" fill="#23644e"/>
    <path d="M0 274Q74 243 111 249T205 233Q253 214 295 230T368 211Q406 194 434 202T516 188Q562 171 601 176V300H0Z" fill="#124c3b"/>
    <path d="M-5 291 Q65 250 112 258T219 239T322 238T426 214T534 202T610 185" stroke="#8ab598" strokeWidth="1" opacity=".48"/>
    <path d="M-5 296 Q65 255 112 263T219 244T322 243T426 219T534 207T610 190" stroke="#8ab598" strokeWidth="1" opacity=".48"/>
    <path d="M-5 301 Q65 260 112 268T219 249T322 248T426 224T534 212T610 195" stroke="#8ab598" strokeWidth="1" opacity=".48"/>
    <path d="M-5 306 Q65 265 112 273T219 254T322 253T426 229T534 217T610 200" stroke="#8ab598" strokeWidth="1" opacity=".48"/>
    <path d="M-5 311 Q65 270 112 278T219 259T322 258T426 234T534 222T610 205" stroke="#8ab598" strokeWidth="1" opacity=".48"/>
    <path d="M-5 316 Q65 275 112 283T219 264T322 263T426 239T534 227T610 210" stroke="#8ab598" strokeWidth="1" opacity=".48"/>
    <path d="M-5 321 Q65 280 112 288T219 269T322 268T426 244T534 232T610 215" stroke="#8ab598" strokeWidth="1" opacity=".48"/>
    <path d="M-5 326 Q65 285 112 293T219 274T322 273T426 249T534 237T610 220" stroke="#8ab598" strokeWidth="1" opacity=".48"/>
    </g>
    </svg>;
  if (theme === "index") return <svg aria-hidden="true" focusable="false" viewBox="0 0 600 300" fill="none">
    <g stroke="#bac6b0" strokeWidth="1">
    <path d="M26 12V285" strokeDasharray="1 9"/>
    <path d="M50 12V285" strokeDasharray="1 9"/>
    <path d="M74 12V285" strokeDasharray="1 9"/>
    <path d="M98 12V285" strokeDasharray="1 9"/>
    <path d="M122 12V285" strokeDasharray="1 9"/>
    <path d="M146 12V285" strokeDasharray="1 9"/>
    <path d="M170 12V285" strokeDasharray="1 9"/>
    <path d="M194 12V285" strokeDasharray="1 9"/>
    <path d="M218 12V285" strokeDasharray="1 9"/>
    <path d="M242 12V285" strokeDasharray="1 9"/>
    <path d="M266 12V285" strokeDasharray="1 9"/>
    <path d="M290 12V285" strokeDasharray="1 9"/>
    <path d="M314 12V285" strokeDasharray="1 9"/>
    <path d="M338 12V285" strokeDasharray="1 9"/>
    <path d="M362 12V285" strokeDasharray="1 9"/>
    <path d="M386 12V285" strokeDasharray="1 9"/>
    <path d="M410 12V285" strokeDasharray="1 9"/>
    <path d="M434 12V285" strokeDasharray="1 9"/>
    <path d="M458 12V285" strokeDasharray="1 9"/>
    <path d="M482 12V285" strokeDasharray="1 9"/>
    <path d="M506 12V285" strokeDasharray="1 9"/>
    <path d="M530 12V285" strokeDasharray="1 9"/>
    <path d="M554 12V285" strokeDasharray="1 9"/>
    <path d="M578 12V285" strokeDasharray="1 9"/>
    </g>
    <g stroke="#375b41" fill="#f8f8f1">
    <path d="M130 250 361 92l150 29-228 159z" fill="#cfdfac"/>
    <path d="m127 233 233-157 149 29-227 160z" fill="#667f59"/>
    <g className="leaf-index">
    <path d="m125 215 233-157 149 29-227 160z" fill="#e7edce"/>
    <path d="m126 214 227-154 13 2-227 154z" fill="#32563d"/>
    <path d="m194 192 105-72 74 14-106 72z" fill="#f8f8e9"/>
    <path d="m224 185 53-36m-40 38 61-41m-27 27 34-23" strokeWidth="2"/>
    </g>
    </g>
    </svg>;
  if (theme === "aperture") return <svg aria-hidden="true" focusable="false" viewBox="0 0 600 300" fill="none">
    <defs>
    <radialGradient id="halo">
    <stop stopColor="#527c76" stopOpacity=".45"/>
    <stop offset=".9" stopColor="#132736" stopOpacity="0"/>
    </radialGradient>
    </defs>
    <ellipse cx="315" cy="154" rx="250" ry="158" fill="url(#halo)"/>
    <circle cx="315" cy="154" r="108" stroke="#688886" strokeWidth=".8" opacity=".55"/>
    <circle cx="315" cy="154" r="119" stroke="#688886" strokeWidth=".8" opacity=".55"/>
    <circle cx="315" cy="154" r="134" stroke="#688886" strokeWidth=".8" opacity=".55"/>
    <path d="M445.00 154.00 l7.00 0.00" stroke="#9db6ae" strokeWidth="1"/>
    <path d="M446.50 165.50 l4.98 0.44" stroke="#9db6ae" strokeWidth="1"/>
    <path d="M444.99 176.92 l4.92 0.87" stroke="#9db6ae" strokeWidth="1"/>
    <path d="M442.50 188.16 l4.83 1.29" stroke="#9db6ae" strokeWidth="1"/>
    <path d="M439.04 199.15 l4.70 1.71" stroke="#9db6ae" strokeWidth="1"/>
    <path d="M434.63 209.79 l4.53 2.11" stroke="#9db6ae" strokeWidth="1"/>
    <path d="M427.58 219.00 l6.06 3.50" stroke="#9db6ae" strokeWidth="1"/>
    <path d="M423.13 229.71 l4.10 2.87" stroke="#9db6ae" strokeWidth="1"/>
    <path d="M416.12 238.85 l3.83 3.21" stroke="#9db6ae" strokeWidth="1"/>
    <path d="M408.34 247.34 l3.54 3.54" stroke="#9db6ae" strokeWidth="1"/>
    <path d="M399.85 255.12 l3.21 3.83" stroke="#9db6ae" strokeWidth="1"/>
    <path d="M390.71 262.13 l2.87 4.10" stroke="#9db6ae" strokeWidth="1"/>
    <path d="M380.00 266.58 l3.50 6.06" stroke="#9db6ae" strokeWidth="1"/>
    <path d="M370.79 273.63 l2.11 4.53" stroke="#9db6ae" strokeWidth="1"/>
    <path d="M360.15 278.04 l1.71 4.70" stroke="#9db6ae" strokeWidth="1"/>
    <path d="M349.16 281.50 l1.29 4.83" stroke="#9db6ae" strokeWidth="1"/>
    <path d="M337.92 283.99 l0.87 4.92" stroke="#9db6ae" strokeWidth="1"/>
    <path d="M326.50 285.50 l0.44 4.98" stroke="#9db6ae" strokeWidth="1"/>
    <path d="M315.00 284.00 l0.00 7.00" stroke="#9db6ae" strokeWidth="1"/>
    <path d="M303.50 285.50 l-0.44 4.98" stroke="#9db6ae" strokeWidth="1"/>
    <path d="M292.08 283.99 l-0.87 4.92" stroke="#9db6ae" strokeWidth="1"/>
    <path d="M280.84 281.50 l-1.29 4.83" stroke="#9db6ae" strokeWidth="1"/>
    <path d="M269.85 278.04 l-1.71 4.70" stroke="#9db6ae" strokeWidth="1"/>
    <path d="M259.21 273.63 l-2.11 4.53" stroke="#9db6ae" strokeWidth="1"/>
    <path d="M250.00 266.58 l-3.50 6.06" stroke="#9db6ae" strokeWidth="1"/>
    <path d="M239.29 262.13 l-2.87 4.10" stroke="#9db6ae" strokeWidth="1"/>
    <path d="M230.15 255.12 l-3.21 3.83" stroke="#9db6ae" strokeWidth="1"/>
    <path d="M221.66 247.34 l-3.54 3.54" stroke="#9db6ae" strokeWidth="1"/>
    <path d="M213.88 238.85 l-3.83 3.21" stroke="#9db6ae" strokeWidth="1"/>
    <path d="M206.87 229.71 l-4.10 2.87" stroke="#9db6ae" strokeWidth="1"/>
    <path d="M202.42 219.00 l-6.06 3.50" stroke="#9db6ae" strokeWidth="1"/>
    <path d="M195.37 209.79 l-4.53 2.11" stroke="#9db6ae" strokeWidth="1"/>
    <path d="M190.96 199.15 l-4.70 1.71" stroke="#9db6ae" strokeWidth="1"/>
    <path d="M187.50 188.16 l-4.83 1.29" stroke="#9db6ae" strokeWidth="1"/>
    <path d="M185.01 176.92 l-4.92 0.87" stroke="#9db6ae" strokeWidth="1"/>
    <path d="M183.50 165.50 l-4.98 0.44" stroke="#9db6ae" strokeWidth="1"/>
    <path d="M185.00 154.00 l-7.00 0.00" stroke="#9db6ae" strokeWidth="1"/>
    <path d="M183.50 142.50 l-4.98 -0.44" stroke="#9db6ae" strokeWidth="1"/>
    <path d="M185.01 131.08 l-4.92 -0.87" stroke="#9db6ae" strokeWidth="1"/>
    <path d="M187.50 119.84 l-4.83 -1.29" stroke="#9db6ae" strokeWidth="1"/>
    <path d="M190.96 108.85 l-4.70 -1.71" stroke="#9db6ae" strokeWidth="1"/>
    <path d="M195.37 98.21 l-4.53 -2.11" stroke="#9db6ae" strokeWidth="1"/>
    <path d="M202.42 89.00 l-6.06 -3.50" stroke="#9db6ae" strokeWidth="1"/>
    <path d="M206.87 78.29 l-4.10 -2.87" stroke="#9db6ae" strokeWidth="1"/>
    <path d="M213.88 69.15 l-3.83 -3.21" stroke="#9db6ae" strokeWidth="1"/>
    <path d="M221.66 60.66 l-3.54 -3.54" stroke="#9db6ae" strokeWidth="1"/>
    <path d="M230.15 52.88 l-3.21 -3.83" stroke="#9db6ae" strokeWidth="1"/>
    <path d="M239.29 45.87 l-2.87 -4.10" stroke="#9db6ae" strokeWidth="1"/>
    <path d="M250.00 41.42 l-3.50 -6.06" stroke="#9db6ae" strokeWidth="1"/>
    <path d="M259.21 34.37 l-2.11 -4.53" stroke="#9db6ae" strokeWidth="1"/>
    <path d="M269.85 29.96 l-1.71 -4.70" stroke="#9db6ae" strokeWidth="1"/>
    <path d="M280.84 26.50 l-1.29 -4.83" stroke="#9db6ae" strokeWidth="1"/>
    <path d="M292.08 24.01 l-0.87 -4.92" stroke="#9db6ae" strokeWidth="1"/>
    <path d="M303.50 22.50 l-0.44 -4.98" stroke="#9db6ae" strokeWidth="1"/>
    <path d="M315.00 24.00 l-0.00 -7.00" stroke="#9db6ae" strokeWidth="1"/>
    <path d="M326.50 22.50 l0.44 -4.98" stroke="#9db6ae" strokeWidth="1"/>
    <path d="M337.92 24.01 l0.87 -4.92" stroke="#9db6ae" strokeWidth="1"/>
    <path d="M349.16 26.50 l1.29 -4.83" stroke="#9db6ae" strokeWidth="1"/>
    <path d="M360.15 29.96 l1.71 -4.70" stroke="#9db6ae" strokeWidth="1"/>
    <path d="M370.79 34.37 l2.11 -4.53" stroke="#9db6ae" strokeWidth="1"/>
    <path d="M380.00 41.42 l3.50 -6.06" stroke="#9db6ae" strokeWidth="1"/>
    <path d="M390.71 45.87 l2.87 -4.10" stroke="#9db6ae" strokeWidth="1"/>
    <path d="M399.85 52.88 l3.21 -3.83" stroke="#9db6ae" strokeWidth="1"/>
    <path d="M408.34 60.66 l3.54 -3.54" stroke="#9db6ae" strokeWidth="1"/>
    <path d="M416.12 69.15 l3.83 -3.21" stroke="#9db6ae" strokeWidth="1"/>
    <path d="M423.13 78.29 l4.10 -2.87" stroke="#9db6ae" strokeWidth="1"/>
    <path d="M427.58 89.00 l6.06 -3.50" stroke="#9db6ae" strokeWidth="1"/>
    <path d="M434.63 98.21 l4.53 -2.11" stroke="#9db6ae" strokeWidth="1"/>
    <path d="M439.04 108.85 l4.70 -1.71" stroke="#9db6ae" strokeWidth="1"/>
    <path d="M442.50 119.84 l4.83 -1.29" stroke="#9db6ae" strokeWidth="1"/>
    <path d="M444.99 131.08 l4.92 -0.87" stroke="#9db6ae" strokeWidth="1"/>
    <path d="M446.50 142.50 l4.98 -0.44" stroke="#9db6ae" strokeWidth="1"/>
    <g className="iris-blades">
    <path d="M315 51 A103 103 0 0 1 388 81 L352 141 328 112 289 95Z" transform="rotate(0 315 154)" fill="#456969" stroke="#19343b" strokeWidth="1.2"/>
    <path d="M315 51 A103 103 0 0 1 388 81 L352 141 328 112 289 95Z" transform="rotate(45 315 154)" fill="#54807a" stroke="#19343b" strokeWidth="1.2"/>
    <path d="M315 51 A103 103 0 0 1 388 81 L352 141 328 112 289 95Z" transform="rotate(90 315 154)" fill="#729488" stroke="#19343b" strokeWidth="1.2"/>
    <path d="M315 51 A103 103 0 0 1 388 81 L352 141 328 112 289 95Z" transform="rotate(135 315 154)" fill="#94aaa3" stroke="#19343b" strokeWidth="1.2"/>
    <path d="M315 51 A103 103 0 0 1 388 81 L352 141 328 112 289 95Z" transform="rotate(180 315 154)" fill="#678d88" stroke="#19343b" strokeWidth="1.2"/>
    <path d="M315 51 A103 103 0 0 1 388 81 L352 141 328 112 289 95Z" transform="rotate(225 315 154)" fill="#527578" stroke="#19343b" strokeWidth="1.2"/>
    <path d="M315 51 A103 103 0 0 1 388 81 L352 141 328 112 289 95Z" transform="rotate(270 315 154)" fill="#375c65" stroke="#19343b" strokeWidth="1.2"/>
    <path d="M315 51 A103 103 0 0 1 388 81 L352 141 328 112 289 95Z" transform="rotate(315 315 154)" fill="#33565e" stroke="#19343b" strokeWidth="1.2"/>
    </g>
    <circle cx="315" cy="154" r="35" fill="#22393f"/>
    <circle cx="315" cy="154" r="31" stroke="#a1b7a9" strokeOpacity=".4"/>
    <circle cx="315" cy="154" r="4" fill="#d7ddac"/>
    </svg>;
  if (theme === "fold") return <svg aria-hidden="true" focusable="false" viewBox="0 0 600 300" fill="none">
    <defs>
    <linearGradient id="f1" x1="0" x2="1" y1="0" y2="1">
    <stop stopColor="#d0b6d8"/>
    <stop offset="1" stopColor="#aa8dbc"/>
    </linearGradient>
    </defs>
    <path d="m90 229 211-123 198 52-212 108z" fill="#8f729d" opacity=".18"/>
    <g className="folio">
    <path d="m89 202 212-119 195 53-213 119z" fill="#2a5846"/>
    <path d="m89 195 212-119 195 53-213 119z" fill="#739d88"/>
    <path d="m89 185 212-119 195 53-213 119z" fill="#eee4ee" stroke="#7f6b8a"/>
    <path d="m89 178 212-119 195 53-213 119z" fill="url(#f1)" stroke="#806c8b"/>
    <path d="m89 178 212-119-71 115-19 38Z" fill="#e8d9eb"/>
    <path d="m211 212 19-38 71-115 19 69Z" fill="#9e76b4"/>
    <path d="m321 129 175-17-213 119-71-19Z" fill="#bea2cc"/>
    <path d="m373 158 68-39" stroke="#5b4366" strokeWidth="2"/>
    <path d="m379 161 40-23" stroke="#5b4366"/>
    </g>
    </svg>;
  const { d, transform } = suturePose(0);
  return <svg aria-hidden="true" focusable="false" viewBox="0 0 600 260" fill="none">
    <path d="M0 229H600" stroke="#d1dfd3" strokeDasharray="2 9" />
    <path data-suture-thread d={d} stroke="#216a4e" strokeWidth="4" strokeLinecap="round" />
    <g data-suture-needle transform={transform}>
      <path d={METAL} fill="#6a697b" />
      <path d="M6 1 Q56 17 81 -10" stroke="#bbc2c4" strokeWidth="1.45" />
      <path d="M0 0L6 1.8" stroke="#536958" strokeWidth="4.4" strokeLinecap="round" />
    </g>
  </svg>;
}
