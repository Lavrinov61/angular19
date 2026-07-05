export interface User {
  uid: string;
  email: string;
  displayName?: string;
  photoURL?: string;
  phoneNumber?: string;
  isAdmin?: boolean;
  createdAt: Date | string;
  lastLogin?: Date | string;
}
