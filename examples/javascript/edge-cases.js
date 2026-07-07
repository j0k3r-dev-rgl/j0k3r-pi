/**
 * JavaScript fixture for find_references edge cases.
 */

const fns = {
  helper: () => {},
};

export const { helper } = fns;

export function useLater(cb) {
  cb();
}

export function run() {
  helper();
  useLater(helper);
}
