export type AuthorizationScope =
  | "platform"
  | "clinic"
  | "clinic_location"
  | "doctor"
  | "patient"
  | "appointment"
  | "doctor_clinic"
  | "self";

export type AuthorizationTarget = {
  scope: AuthorizationScope;
  scopeId?: string | null;
};

export type PermissionRequirement = {
  code: string;
  scope: AuthorizationScope;
  scopeId?: string;
  param?: string;
  query?: string;
  body?: string;
};
