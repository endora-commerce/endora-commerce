'use client';

import type { ReactNode } from 'react';
import type { ComponentConfig, Fields } from '@puckeditor/core';
import { createToggleField, withHideOn } from '@endora-commerce/page-builder-core';
import { useBlockData } from '../../hooks/use-block-data.js';
import type { FormBlockProps } from '../../schema/component-types.js';
import { formBlockDataRequest } from '../../utils/block-data.js';
import type { FormBlockData } from '../../utils/catalog-preview-bridge.js';
import { BUTTON_SPEC_OBJECT_FIELDS } from '../Button.js';
import { FormBlock } from './FormBlock.js';

/**
 * `forms.Form` in the Page Builder (`specs/170-forms-module/` contracts/blocks-and-storefront.md
 * §1–§3, research R-8): declared by the `forms` manifest, rendered from here.
 *
 * **Only presets** (FR-003, FR-005, US2-9): the form, a field look, a size, the button's look
 * (style, fill and size — the looks every button offers, without its colour pickers), an alignment
 * and the title and description switches. The block holds no text, no field and no recipient, and
 * no pixel or colour: the form is the `forms` module's, and the look follows the section's colour
 * scheme. The admin swaps the form id's text input for a picker of the forms the editor may see.
 *
 * The form's public read is block data (`form` kind): resolved on the server by the storefront, so
 * the form is in the HTML, and read through the editor's preview API on the canvas.
 */

const FORM_FIELDS = {
  formId: { type: 'text' as const, label: 'Form' },
  fieldLook: {
    type: 'select' as const,
    label: 'Field look',
    options: [
      { label: 'Boxed', value: 'boxed' },
      { label: 'Underline', value: 'underline' },
      { label: 'Pill', value: 'pill' },
    ],
  },
  size: {
    type: 'select' as const,
    label: 'Size',
    options: [
      { label: 'Small', value: 's' },
      { label: 'Medium', value: 'm' },
      { label: 'Large', value: 'l' },
    ],
  },
  buttonLook: {
    type: 'object' as const,
    label: 'Button',
    objectFields: {
      style: BUTTON_SPEC_OBJECT_FIELDS.style,
      fill: BUTTON_SPEC_OBJECT_FIELDS.fill,
      size: BUTTON_SPEC_OBJECT_FIELDS.size,
    },
  },
  align: {
    type: 'radio' as const,
    label: 'Alignment',
    options: [
      { label: 'Start', value: 'start' },
      { label: 'Center', value: 'center' },
    ],
  },
  showTitle: createToggleField({ label: 'Show the form title', defaultValue: true }),
  showDescription: createToggleField({ label: 'Show the form description', defaultValue: true }),
};

function FormBlockWithData(props: FormBlockProps & { id?: string }): ReactNode {
  const { data } = useBlockData<FormBlockData>(formBlockDataRequest({ formId: props.formId }));
  return <FormBlock {...props} definition={data} />;
}

const formConfig: ComponentConfig<{ props: FormBlockProps }> = {
  label: 'Form',
  fields: FORM_FIELDS as unknown as Fields<FormBlockProps>,
  defaultProps: {
    formId: '',
    fieldLook: 'boxed',
    size: 'm',
    buttonLook: { style: 'primary', fill: 'solid', size: 'medium' },
    align: 'start',
    showTitle: true,
    showDescription: true,
  } as FormBlockProps,
  render: (props) => <FormBlockWithData {...(props as FormBlockProps & { id?: string })} />,
};

/**
 * The block, exported under its name's local segment (`forms.Form`), as every block of this
 * package is: the SSR floor reconciles the components map with the exported block configs by it.
 */
export const Form = withHideOn(formConfig);
