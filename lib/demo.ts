import type { Pet, Vaccination } from "./types";
export const demoPet: Pet = {
  id: "sample",
  household_id: "sample",
  name: "Milo",
  species: "Dog",
  breed: "Golden Retriever",
  birth_date: "2022-04-12",
  sex: "Male",
  microchip: "985 141 002 847 619",
};
export const demoVaccinations: Vaccination[] = [
  {
    id: "1",
    pet_id: "sample",
    name: "Rabies",
    administered_on: "2026-06-12",
    due_on: "2027-06-12",
    clinic: "Oak & Willow Veterinary",
  },
  {
    id: "2",
    pet_id: "sample",
    name: "DHPP",
    administered_on: "2026-06-12",
    due_on: "2027-06-12",
    clinic: "Oak & Willow Veterinary",
  },
  {
    id: "3",
    pet_id: "sample",
    name: "Bordetella",
    administered_on: "2026-03-24",
    due_on: "2026-09-24",
    clinic: "Oak & Willow Veterinary",
  },
];
