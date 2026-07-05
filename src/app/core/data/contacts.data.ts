export const WHATSAPP_UNAVAILABLE_NOTICE = 'Временно не работает';

export interface PublicContactLink {
  label: string;
  href: string;
  icon: string;
  notice?: string;
}

export interface PublicContactsData {
  title: string;
  prompt: string;
  links: PublicContactLink[];
}

export const CONTACTS: PublicContactsData = {
  title:  'Свяжитесь с нами',
  prompt: 'Выберите удобный способ связи для консультации и записи на фотосессию',
  links: [
    // Fallback ссылки - DeepLinkService заменит их на динамические с fingerprint
    { label:'МАКС', href:'https://max.ru/id262603741214_bot', icon:'max' },
    { label:'Telegram', href:'https://t.me/FmagnusBot',  icon:'telegram' },
    { label:'WhatsApp', href:'https://wa.me/+79014178668', icon:'whatsapp', notice: WHATSAPP_UNAVAILABLE_NOTICE },
    { label:'ВКонтакте', href:'https://vk.com/im?sel=-68371131', icon:'vk' }
  ]
};
