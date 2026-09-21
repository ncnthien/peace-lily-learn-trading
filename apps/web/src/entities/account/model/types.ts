/**
 * Account domain types. The backend's AccountRecord lives in
 * @workspace/shared; this file only declares the wire type we consume
 * client-side. Keep it minimal — extend @workspace/shared if new fields
 * appear.
 */

export interface AccountRecord {
  id: string;
  name: string;
  type: 'real' | 'demo';
  balance: number;
  status: 'active' | 'disabled';
  createdAt: string;
  updatedAt: string;
}
