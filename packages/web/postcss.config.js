import autoprefixer from 'autoprefixer';

// Vendor prefixes for the browsers in package.json's browserslist (an Edge from
// 2022 still needs -webkit-mask-image, Safari needs -webkit-backdrop-filter).
export default { plugins: [autoprefixer()] };
