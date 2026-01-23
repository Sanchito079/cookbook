import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// Import translation files
import en from './locales/en.json';
import zh from './locales/zh.json';
import es from './locales/es.json';
import ru from './locales/ru.json';
import ko from './locales/ko.json';
import pt from './locales/pt.json';
import tr from './locales/tr.json';
import ar from './locales/ar.json';

const resources = {
  en: { translation: en },
  zh: { translation: zh },
  es: { translation: es },
  ru: { translation: ru },
  ko: { translation: ko },
  pt: { translation: pt },
  tr: { translation: tr },
  ar: { translation: ar },
};

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: localStorage.getItem('selectedLanguage') || 'en', // load from localStorage or default to 'en'
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false, // React already escapes values
    },
    react: {
      useSuspense: false,
    },
  });

export default i18n;