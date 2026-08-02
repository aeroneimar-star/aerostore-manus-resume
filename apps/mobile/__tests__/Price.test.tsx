import { render } from '@testing-library/react-native';
import { describe, expect, it } from '@jest/globals';
import { Price } from '@/components/Price';

describe('Price component', () => {
  it('formats 45990 cents as R$ 459,90', () => {
    const screen = render(<Price priceCents={45990} />);
    expect(screen.getByText('R$ 459,90')).toBeTruthy();
  });

  it('formats 14990 cents as R$ 149,90', () => {
    const screen = render(<Price priceCents={14990} />);
    expect(screen.getByText('R$ 149,90')).toBeTruthy();
  });

  it('formats 19990 cents as R$ 199,90', () => {
    const screen = render(<Price priceCents={19990} />);
    expect(screen.getByText('R$ 199,90')).toBeTruthy();
  });

  it('formats price and compare-at-price together', () => {
    const screen = render(<Price priceCents={38990} compareAtPriceCents={42990} />);
    expect(screen.getByText('R$ 389,90')).toBeTruthy();
    expect(screen.getByText('R$ 429,90')).toBeTruthy();
  });

  it('does not use thousand separators on cents', () => {
    const screen = render(<Price priceCents={9990} />);
    expect(screen.getByText('R$ 99,90')).toBeTruthy();
    expect(screen.queryByText('R$ 9.990')).toBeNull();
  });
});
