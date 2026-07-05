/** Common DB row shapes reused across multiple modules. */

export interface CountResult {
  cnt: number;
}

export interface TotalCount {
  total: number;
}

export interface ExistsResult {
  has: boolean;
}

export interface IdOnly {
  id: string;
}

export interface UserDisplayName {
  display_name: string | null;
}

export interface UserDisplayNameEmail {
  display_name: string | null;
  email: string;
}

export interface UserIdDisplayEmail {
  id: string;
  display_name: string | null;
  email: string;
}

export interface UserNamePhone {
  display_name: string | null;
  phone: string | null;
}

export interface UserPhone {
  id: string;
  display_name: string | null;
  phone: string | null;
}

export interface UserContact {
  id: string;
  display_name: string | null;
  email: string;
  role: string;
}
