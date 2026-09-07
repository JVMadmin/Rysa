import { Platform, Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

export interface PickedFile {
  name: string;
  type: string;
  size: number;
  uri: string;
  rawFile?: any; // Objeto File en entorno Web o react-native-web
}

/**
 * Permite seleccionar un archivo o imagen de la galería.
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

  // Entorno nativo (Android / iOS): selección desde galería
  try {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permiso requerido', 'Se necesita permiso para acceder a la galería.');
      return null;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 0.75,
      base64: true,
    });

    if (result.canceled || !result.assets || result.assets.length === 0) {
      return null;
    }

    const asset = result.assets[0];
    const mime = asset.mimeType || 'image/jpeg';
    const name = asset.fileName || `foto_${Date.now()}.jpg`;
    const uri = asset.base64
      ? `data:${mime};base64,${asset.base64}`
      : asset.uri;

    return {
      name,
      type: mime,
      size: asset.fileSize || 0,
      uri,
    };
  } catch (err: any) {
    console.warn('[filePicker] Error al abrir galería:', err);
    return null;
  }
}

/**
 * Permite capturar una foto directamente con la cámara del dispositivo móvil.
 */
export async function takePhoto(): Promise<PickedFile | null> {
  if (Platform.OS === 'web') {
    return pickDocument('image/*');
  }

  try {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permiso requerido', 'Se necesita permiso de cámara para tomar fotos de visitas y documentos.');
      return null;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 0.75,
      base64: true,
    });

    if (result.canceled || !result.assets || result.assets.length === 0) {
      return null;
    }

    const asset = result.assets[0];
    const mime = asset.mimeType || 'image/jpeg';
    const name = asset.fileName || `camara_${Date.now()}.jpg`;
    const uri = asset.base64
      ? `data:${mime};base64,${asset.base64}`
      : asset.uri;

    return {
      name,
      type: mime,
      size: asset.fileSize || 0,
      uri,
    };
  } catch (err: any) {
    console.warn('[filePicker] Error al tomar foto:', err);
    return null;
  }
}

/**
 * Muestra opciones para tomar foto con cámara o seleccionar de galería.
 */
export async function pickImageOrPhoto(title: string = 'Adjuntar Imagen'): Promise<PickedFile | null> {
  if (Platform.OS === 'web') {
    return pickDocument('image/*');
  }

  return new Promise((resolve) => {
    Alert.alert(
      title,
      'Selecciona el origen de la imagen:',
      [
        {
          text: 'Tomar Foto (Cámara)',
          onPress: async () => {
            const res = await takePhoto();
            resolve(res);
          },
        },
        {
          text: 'Elegir de Galería',
          onPress: async () => {
            const res = await pickDocument('image/*');
            resolve(res);
          },
        },
        {
          text: 'Cancelar',
          style: 'cancel',
          onPress: () => resolve(null),
        },
      ],
      { cancelable: true, onDismiss: () => resolve(null) }
    );
  });
}
