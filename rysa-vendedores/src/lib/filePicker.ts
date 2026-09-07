import { Platform } from 'react-native';

export interface PickedFile {
  name: string;
  type: string;
  size: number;
  uri: string;
  rawFile?: any; // Objeto File en entorno Web o react-native-web
}

/**
 * Permite seleccionar un archivo (imagen o PDF) en Web y Mobile.
 */
export async function pickDocument(
  accept: string = 'image/*,application/pdf'
): Promise<PickedFile | null> {
  // Entorno Web / Navegador / Simulación Expo Web
  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.style.display = 'none';

      input.onchange = (e: any) => {
        const file = e.target?.files?.[0];
        if (!file) {
          resolve(null);
          return;
        }

        const reader = new FileReader();
        reader.onload = () => {
          resolve({
            name: file.name,
            type: file.type || 'application/octet-stream',
            size: file.size,
            uri: reader.result as string,
            rawFile: file,
          });
        };
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(file);
      };

      document.body.appendChild(input);
      input.click();
      setTimeout(() => {
        if (input.parentNode) {
          input.parentNode.removeChild(input);
        }
      }, 1000);
    });
  }

  return null;
}
