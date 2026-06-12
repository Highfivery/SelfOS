// CSS Modules: the bundler (vite / electron-vite) turns `.module.css` imports into a class-name map.
declare module '*.module.css' {
  const classes: Record<string, string>;
  export default classes;
}
