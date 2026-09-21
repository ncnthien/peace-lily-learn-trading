/**
 * Public API of the `manage-automation` feature.
 *
 * Exposes the form dialog used by the Automation view to create or edit
 * a rule. Sub-components (action / condition / input-kind field sets)
 * are intentionally not re-exported — they are internal collaborators of
 * the dialog and should not be imported by other layers.
 */
export { AutomationFormDialog } from './ui/automation-form-dialog';
export type { AutomationFormDialogProps } from './ui/automation-form-dialog';
