export type Pet = {
  id: string;
  household_id: string;
  name: string;
  species: string;
  breed: string;
  birth_date: string | null;
  sex: string;
  microchip: string | null;
};
export type Vaccination = {
  id: string;
  pet_id: string;
  name: string;
  administered_on: string;
  due_on: string | null;
  clinic: string;
};
export type SharePass = {
  id: string;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
};
export type ActionState = {
  error?: string;
  success?: string;
  url?: string;
  expiresAt?: string;
};
