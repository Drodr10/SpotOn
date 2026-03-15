// Type declarations for static image assets.
// Allows: import logo from '@/assets/images/logo.png'
declare module '*.png' {
  const value: number;
  export default value;
}

declare module '*.jpg' {
  const value: number;
  export default value;
}

declare module '*.jpeg' {
  const value: number;
  export default value;
}

declare module '*.gif' {
  const value: number;
  export default value;
}

declare module '*.otf' {
  const value: number;
  export default value;
}
