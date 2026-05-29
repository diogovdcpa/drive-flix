# drive-flix

Extensão para o Google Drive que organiza os arquivos em uma interface mais visual, com grade responsiva, preview em modal e navegação sequencial entre vídeos.

## Objetivo

O projeto melhora a experiência de navegação no Google Drive, exibindo os arquivos com visual inspirado em catálogo de mídia. A extensão:

- mostra uma grade responsiva dos itens encontrados na pasta atual
- destaca vídeos com thumbnail e preview
- permite abrir, fechar e navegar entre arquivos diretamente no modal

## Como rodar

1. Abra o Chrome e acesse `chrome://extensions`
2. Ative o modo do desenvolvedor
3. Clique em `Load unpacked` / `Carregar sem compactação`
4. Selecione a raiz deste repositório
5. Abra o Google Drive em `https://drive.google.com`
6. Recarregue a página para carregar a extensão

## Estrutura principal

- `manifest.json`: configuração da extensão
- `content.js`: lógica principal de leitura e exibição dos arquivos
- `styles.css`: estilos da interface da extensão

## Observações

- Não há build nem dependências externas neste repositório.
- Após alterar o código, basta recarregar a extensão em `chrome://extensions` e atualizar a aba do Drive.

