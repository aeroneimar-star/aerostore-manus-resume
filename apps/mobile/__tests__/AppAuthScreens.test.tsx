import { fireEvent, render } from '@testing-library/react-native';
import { describe, expect, it, jest } from '@jest/globals';
import { StyleSheet } from 'react-native';
import { AccessStatusScreen } from '@/screens/AccessStatusScreen';
import { OtpVerificationScreen } from '@/screens/OtpVerificationScreen';
import { PhoneEntryScreen } from '@/screens/PhoneEntryScreen';
import { theme } from '@/theme';

describe('phone OTP access flow', () => {
  it('renders branded phone entry and validates before continuing', () => {
    const onContinue=jest.fn(); const screen=render(<PhoneEntryScreen loading={false} onContinue={onContinue}/>);
    expect(screen.getByText('AEROSTORE')).toBeTruthy(); const button=screen.getByLabelText('Receber código pelo WhatsApp');
    expect(button).toHaveProp('accessibilityState',{disabled:true}); fireEvent.changeText(screen.getByLabelText('Número de WhatsApp'),'11987654321'); fireEvent.press(button); expect(onContinue).toHaveBeenCalledWith('11987654321');
  });
  it('shows loading and friendly error on phone screen',()=>{const screen=render(<PhoneEntryScreen loading error="Tente novamente" onContinue={jest.fn()}/>);expect(screen.getByLabelText('Enviando código')).toBeTruthy();expect(screen.getByRole('alert')).toHaveTextContent('Tente novamente');});
  it('exposes visible keyboard focus on the primary action',()=>{const screen=render(<PhoneEntryScreen loading={false} onContinue={jest.fn()}/>);fireEvent.changeText(screen.getByLabelText('Número de WhatsApp'),'11987654321');const button=screen.getByLabelText('Receber código pelo WhatsApp');fireEvent(button,'focus',{currentTarget:{matches:(selector:string)=>selector===':focus-visible'}});expect(StyleSheet.flatten(button.props.style)).toEqual(expect.objectContaining({outlineColor:theme.colors.copperSoft,outlineWidth:3}));});
  it('accepts only six numeric OTP digits and submits',()=>{const onVerify=jest.fn();const screen=render(<OtpVerificationScreen channel="WHATSAPP" smsAvailable={false} loading={false} onVerify={onVerify} onResend={jest.fn()} onSms={jest.fn()}/>);fireEvent.changeText(screen.getByLabelText('Código de seis dígitos'),'12a3456');fireEvent.press(screen.getByText('Confirmar código'));expect(onVerify).toHaveBeenCalledWith('123456');});
  it('offers SMS only when backend permits it',()=>{const base={channel:'WHATSAPP' as const,loading:false,onVerify:jest.fn(),onResend:jest.fn(),onSms:jest.fn()};const first=render(<OtpVerificationScreen {...base} smsSupported={false} smsAvailable={false}/>);expect(first.queryByText('Receber por SMS')).toBeNull();first.unmount();const second=render(<OtpVerificationScreen {...base} smsAvailable/>);expect(second.getByText('Receber por SMS')).toBeTruthy();});
  it('supports resend, SMS and error feedback',()=>{const onResend=jest.fn(),onSms=jest.fn();const screen=render(<OtpVerificationScreen channel="WHATSAPP" smsAvailable loading={false} error="Código expirado" onVerify={jest.fn()} onResend={onResend} onSms={onSms}/>);fireEvent.press(screen.getByText('Reenviar pelo WhatsApp'));fireEvent.press(screen.getByText('Receber por SMS'));expect(onResend).toHaveBeenCalled();expect(onSms).toHaveBeenCalled();expect(screen.getByRole('alert')).toHaveTextContent('Código expirado');});
  for (const [status,message] of [['PENDING_APPROVAL','Seu cadastro está em análise.'],['APPROVED','Seu acesso foi aprovado.'],['REJECTED','Não foi possível liberar seu acesso.'],['SUSPENDED','Seu acesso está indisponível.'],['BLOCKED','Seu acesso está indisponível.']] as const) {
    it(`renders ${status} without catalog access`,()=>{const screen=render(<AccessStatusScreen status={status}/>);expect(screen.getByText(message)).toBeTruthy();expect(screen.queryByText(/Abrir catálogo/i)).toBeNull();});
  }
  it('renders the pre-verification status safely',()=>{const screen=render(<AccessStatusScreen status="PENDING_PHONE_VERIFICATION"/>);expect(screen.getByText('Confirme seu telefone.')).toBeTruthy();});
});
