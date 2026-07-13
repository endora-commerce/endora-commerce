import type { DragAxis } from '@measured/puck';

/** Shared Puck slot props for layout components in editing mode. */
export interface LayoutSlotEditProps {
  minEmptyHeight: number;
  collisionAxis: DragAxis;
  className: string;
}

/** Row column slot — horizontal insertion between columns. */
export const ROW_SLOT_EDIT_PROPS: LayoutSlotEditProps = {
  minEmptyHeight: 144,
  collisionAxis: 'dynamic',
  className: 'cmsc-pb-slot cmsc-pb-row-slot',
};

/** Column content slot — vertical stack of blocks. */
export const COLUMN_SLOT_EDIT_PROPS: LayoutSlotEditProps = {
  minEmptyHeight: 120,
  collisionAxis: 'y',
  className: 'cmsc-pb-slot cmsc-pb-column-slot',
};
