/** Types for the bot engine (button data, bot responses). */

export interface ButtonData {
  serviceId?: string;
  delivery_method?: string;
  customSize?: string;
  value?: string;
  [key: string]: unknown;
}

export interface BotButton {
  value: string;
  label: string;
  data?: Record<string, unknown>;
}
