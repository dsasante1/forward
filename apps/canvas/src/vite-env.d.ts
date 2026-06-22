/// <reference types="vite/client" />

// Canvas styles are imported as a string and injected into the Shadow DOM.
declare module "*.css?inline" {
  const css: string;
  export default css;
}
