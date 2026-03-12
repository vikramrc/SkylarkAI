import Button from '@mui/material/Button';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import { useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { LocaleCode } from '@/types/chat';

const languages: LocaleCode[] = ['en', 'ja', 'zh', 'ko'];

export default function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  function handleOpen(event: MouseEvent<HTMLElement>) {
    setAnchorEl(event.currentTarget);
  }

  function handleClose() {
    setAnchorEl(null);
  }

  function handleSelect(language: LocaleCode) {
    void i18n.changeLanguage(language);
    localStorage.setItem('skylarkai.language', language);
    handleClose();
  }

  const currentLanguage = (i18n.language?.slice(0, 2) ?? 'en') as LocaleCode;

  return (
    <>
      <Button
        variant="outlined"
        onClick={handleOpen}
        sx={{
          minWidth: { xs: 58, sm: 64 },
          minHeight: 32,
          px: { xs: 1, sm: 1.25 },
          whiteSpace: 'nowrap',
          borderRadius: 1.5,
          backgroundColor: 'rgba(255,255,255,0.72)',
          borderColor: 'rgba(15,23,42,0.10)',
          fontWeight: 700,
          fontSize: 12,
          letterSpacing: '0.08em',
        }}
      >
        {currentLanguage.toUpperCase()}
      </Button>
      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={handleClose}>
        {languages.map((language) => (
          <MenuItem
            key={language}
            selected={language === currentLanguage}
            onClick={() => handleSelect(language)}
            sx={{ minWidth: 148, borderRadius: 1, mx: 0.5, my: 0.25 }}
          >
            {t(`languages.${language}`)}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}