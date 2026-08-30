import * as migration_20260829_201814 from './20260829_201814';

export const migrations = [
  {
    up: migration_20260829_201814.up,
    down: migration_20260829_201814.down,
    name: '20260829_201814',
  },
];
