/**
 * Semantic theme tokens — Fase 3.7.1
 *
 * Centraliza todas as cores por função (não por valor literal).
 * Componentes acessam tokens semânticos via useAppTheme().
 * O dark atual é preservado materialmente.
 */

export interface ThemeTokens {
  // Superfícies
  background: string;
  surface: string;
  surfaceElevated: string;
  surfaceMuted: string;
  card: string;
  overlay: string;

  // Texto
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  textInverse: string;
  textDisabled: string;

  // Bordas
  border: string;
  borderStrong: string;
  divider: string;
  focusRing: string;

  // Marca e ações
  primary: string;
  primaryHover: string;
  primaryPressed: string;
  primaryText: string;
  secondary: string;
  secondaryText: string;
  accent: string;

  // Estados
  success: string;
  successSurface: string;
  warning: string;
  warningSurface: string;
  error: string;
  errorSurface: string;
  info: string;
  infoSurface: string;

  // Controles
  inputBackground: string;
  inputBorder: string;
  inputPlaceholder: string;
  buttonDisabled: string;
  buttonDisabledText: string;
  chipBackground: string;
  chipSelectedBackground: string;
  skeleton: string;
  skeletonLine: string;
  skeletonPrice: string;
  shadow: string;

  // Cores herdadas da marca (não mudam entre temas)
  copper: string;
  copperSoft: string;
  moss: string;
  amber: string;
  ivory: string;
  paper: string;
  stone: string;
}

export const darkTokens: ThemeTokens = {
  // Superfícies (preservam o dark premium aprovado)
  background: '#10100F',
  surface: '#191918',
  surfaceElevated: '#24231F',
  surfaceMuted: '#1A1A18',
  card: '#1A1A18',
  overlay: 'rgba(16, 16, 15, 0.85)',

  // Texto
  textPrimary: '#E8E8E6',
  textSecondary: '#C8C5BE',
  textMuted: '#8A8A88',
  textInverse: '#10100F',
  textDisabled: '#5A5A55',

  // Bordas
  border: '#252523',
  borderStrong: '#34332F',
  divider: '#302F2B',
  focusRing: 'rgba(196, 128, 84, 0.5)',

  // Marca e ações
  primary: '#E8E8E6',
  primaryHover: '#D0D0CC',
  primaryPressed: '#B8B8B4',
  primaryText: '#10100F',
  secondary: 'transparent',
  secondaryText: '#C48054',
  accent: '#C48054',

  // Estados
  success: '#82977B',
  successSurface: 'rgba(130, 151, 123, 0.12)',
  warning: '#C7A45D',
  warningSurface: 'rgba(199, 164, 93, 0.12)',
  error: '#D99386',
  errorSurface: 'rgba(217, 147, 134, 0.12)',
  info: '#6BA3C7',
  infoSurface: 'rgba(107, 163, 199, 0.12)',

  // Controles
  inputBackground: '#121211',
  inputBorder: '#4A4741',
  inputPlaceholder: '#77726A',
  buttonDisabled: '#3A3832',
  buttonDisabledText: '#5A5A55',
  chipBackground: '#252523',
  chipSelectedBackground: '#34332F',
  skeleton: '#24231F',
  skeletonLine: '#302F2B',
  skeletonPrice: '#3A3832',
  shadow: 'rgba(0, 0, 0, 0.18)',

  // Cores da marca (não mudam)
  copper: '#C48054',
  copperSoft: '#E3B18E',
  moss: '#82977B',
  amber: '#C7A45D',
  ivory: '#F4F0E7',
  paper: '#E8E1D5',
  stone: '#A9A297',
};

export const lightTokens: ThemeTokens = {
  // Superfícies (fundo claro quente, não branco azulado)
  background: '#FDFBF7',
  surface: '#F5F0E8',
  surfaceElevated: '#FFFFFF',
  surfaceMuted: '#EDE7DD',
  card: '#FFFFFF',
  overlay: 'rgba(16, 16, 15, 0.5)',

  // Texto
  textPrimary: '#1A1A18',
  textSecondary: '#4A4741',
  textMuted: '#7A7568',
  textInverse: '#FDFBF7',
  textDisabled: '#B8B0A0',

  // Bordas (discretas)
  border: '#E8E1D5',
  borderStrong: '#D5CCBE',
  divider: '#E0D8CC',
  focusRing: 'rgba(196, 128, 84, 0.4)',

  // Marca e ações
  primary: '#1A1A18',
  primaryHover: '#333330',
  primaryPressed: '#4A4A46',
  primaryText: '#FDFBF7',
  secondary: '#1A1A18',
  secondaryText: '#C48054',
  accent: '#C48054',

  // Estados
  success: '#4A7A3E',
  successSurface: 'rgba(74, 122, 62, 0.08)',
  warning: '#A07830',
  warningSurface: 'rgba(160, 120, 48, 0.08)',
  error: '#B84A3A',
  errorSurface: 'rgba(184, 74, 58, 0.08)',
  info: '#3A7A9A',
  infoSurface: 'rgba(58, 122, 154, 0.08)',

  // Controles
  inputBackground: '#FFFFFF',
  inputBorder: '#D5CCBE',
  inputPlaceholder: '#B8B0A0',
  buttonDisabled: '#E8E1D5',
  buttonDisabledText: '#B8B0A0',
  chipBackground: '#F5F0E8',
  chipSelectedBackground: '#E8E1D5',
  skeleton: '#EDE7DD',
  skeletonLine: '#E0D8CC',
  skeletonPrice: '#D5CCBE',
  shadow: 'rgba(26, 26, 24, 0.08)',

  // Cores da marca (não mudam)
  copper: '#C48054',
  copperSoft: '#E3B18E',
  moss: '#4A7A3E',
  amber: '#C7A45D',
  ivory: '#F4F0E7',
  paper: '#E8E1D5',
  stone: '#A9A297',
};
