with main_symbols(symbol) as (
  values
    ('BINANCE:BTCUSDT'),
    ('BINANCE:ETHUSDT'),
    ('BINANCE:BNBUSDT'),
    ('BINANCE:SOLUSDT'),
    ('BINANCE:XRPUSDT'),
    ('BINANCE:ADAUSDT'),
    ('BINANCE:DOGEUSDT'),
    ('BINANCE:AVAXUSDT'),
    ('BINANCE:LINKUSDT'),
    ('BINANCE:DOTUSDT'),
    ('BINANCE:LTCUSDT'),
    ('BINANCE:BCHUSDT'),
    ('BINANCE:TRXUSDT'),
    ('BINANCE:XLMUSDT'),
    ('BINANCE:ATOMUSDT'),
    ('BINANCE:HBARUSDT'),
    ('BINANCE:AAVEUSDT'),
    ('BINANCE:UNIUSDT'),
    ('BINANCE:NEARUSDT'),
    ('BINANCE:SUIUSDT'),
    ('OANDA:XAUUSD'),
    ('OANDA:EURUSD'),
    ('OANDA:GBPUSD'),
    ('OANDA:USDJPY'),
    ('OANDA:AUDUSD'),
    ('OANDA:USDCHF'),
    ('OANDA:USDCAD'),
    ('OANDA:NZDUSD')
)
update public.chart_symbols_volman as csv
set is_active = exists (
  select 1
  from main_symbols ms
  where ms.symbol = csv.symbol
);
