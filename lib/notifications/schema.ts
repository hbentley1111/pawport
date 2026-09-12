export type OwnerNotification = {
  id: string;
  type:
    | "availability_match"
    | "care_due"
    | "appointment_reminder"
    | "verification_update";
  title: string;
  body: string;
  actionUrl: string;
  createdAt: string;
  readAt: string | null;
  dismissedAt: string | null;
  petName: string | null;
  petId: string | null;
};
export type NotificationPage = {
  notifications: OwnerNotification[];
  nextCursor: { at: string; id: string } | null;
};
