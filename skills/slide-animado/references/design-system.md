# Design system do deck

Tudo fica no bloco `DESIGN SYSTEM` no topo do CSS do `deck-base.html`. Troque só os valores, não os nomes das variáveis.

| Variável | Para que serve |
|---|---|
| `--bg` | fundo do palco |
| `--surface` | cartões, painéis e faixas |
| `--text` / `--muted` | texto principal e secundário |
| `--accent` / `--accent-2` | cores de destaque (círculo, cartões, dots dos bullets) |
| `--on-accent` | texto sobre as cores de destaque |
| `--font-title` / `--font-body` | famílias de fonte |
| `--radius` | raio dos cartões |
| `--ease`, `--ease-out`, `--dur` | curva e duração das animações (500 a 800 ms) |

## Padrão (café escuro com coral)

`--bg:#0B0908; --surface:#2C2724; --text:#F4F3EE; --muted:#B1ADA1; --accent:#E26546; --accent-2:#FFFCA3`, títulos em Fira Sans 800, corpo em Inter.

## Variações

- **Mais sóbrio:** `--accent:#8FA3B8; --accent-2:#D9DEE4; --on-accent:#0B0908`, `--radius:12px`, `--dur:550ms`, bolinha dos bullets pequena.
- **Mais colorido:** `--accent:#FF4D6D; --accent-2:#FFD23F; --surface:#1D1A3A; --bg:#12102B`, `--radius:44px`.
- **Elegante:** fundo claro `--bg:#F4F3EE; --surface:#E7E2D6; --text:#1B1613; --muted:#6B645B; --accent:#9A6B3F; --accent-2:#1B1613; --on-accent:#F4F3EE`, títulos em serifa (`Georgia,'Times New Roman',serif`), peso 700.
- **Marca do aluno:** peça cores (hex), fonte e logo. O logo entra no elemento `.marca` (SVG inline ou `<img>` em base64) mantendo `data-morph="marca"`.

Depois de trocar as cores, confira o contraste de cada tela nos prints.
