import React, { useState, useEffect } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { login, User } from '@/services/auth';
import {
  getBaseUrl,
  setBaseUrl,
  testServerConnection,
  DEFAULT_PROD_URL,
  DEFAULT_LOCAL_LAN_URL,
  DEFAULT_LOCAL_USB_URL,
} from '@/lib/api';

interface LoginScreenProps {
  onLoginSuccess: (user: User) => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLoginSuccess }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  // Configuracion de servidor
  const [currentServer, setCurrentServer] = useState(DEFAULT_LOCAL_LAN_URL);
  const [customServer, setCustomServer] = useState(DEFAULT_LOCAL_LAN_URL);
  const [showServerConfig, setShowServerConfig] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [testingConnection, setTestingConnection] = useState(false);

  useEffect(() => {
    getBaseUrl().then((url) => {
      setCurrentServer(url);
      setCustomServer(url);
    });
  }, []);

  const handleLogin = async () => {
    if (!email.trim() || !password) {
      setErrorMessage('Por favor ingresa tu correo y contraseña');
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    try {
      const user = await login(email, password);
      onLoginSuccess(user);
    } catch (err: any) {
      let msg = err?.message || 'Error al iniciar sesión';
      if (msg.includes('502') || msg.includes('Failed to fetch') || msg.includes('Network request failed')) {
        msg = `No se pudo conectar al servidor (${currentServer}). Verifica que el backend esté activo o cambia de servidor en la opción inferior.`;
      }
      setErrorMessage(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleApplyServer = async (url: string) => {
    await setBaseUrl(url);
    setCurrentServer(url);
    setTestResult(null);
    setErrorMessage(null);
  };

  const handleTestConnection = async (urlToTest?: string) => {
    setTestingConnection(true);
    setTestResult(null);
    try {
      if (urlToTest && urlToTest !== currentServer) {
        await setBaseUrl(urlToTest);
        setCurrentServer(urlToTest);
      }
      const res = await testServerConnection();
      setTestResult(res);
    } finally {
      setTestingConnection(false);
    }
  };

  const isLocalActive = currentServer.includes('192.168.') || currentServer.includes('localhost');

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.container}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header & Branding Institucional */}
          <View style={styles.header}>
            <Image
              source={require('../../assets/images/rysa-logo.png')}
              style={styles.logoImage}
              resizeMode="contain"
            />
            <Text style={styles.brandTitle}>GRUPO RYSA</Text>
            <Text style={styles.brandSubtitle}>Vendedores & Operación en Campo</Text>
            <Text style={styles.brandVersion}>v1.0.0 Oficial</Text>
          </View>

          {/* Form Card */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Acceso de Asesores</Text>

            {errorMessage && (
              <View style={styles.errorBox}>
                <MaterialIcons name="error-outline" size={18} color="#D32F2F" />
                <Text style={styles.errorText}>{errorMessage}</Text>
              </View>
            )}

            {/* Email Field */}
            <Text style={styles.label}>Correo Electrónico</Text>
            <View style={styles.inputContainer}>
              <MaterialIcons name="email" size={20} color="#718096" style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="asesor@gruporysa.com"
                placeholderTextColor="#A0AEC0"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                editable={!loading}
              />
            </View>

            {/* Password Field */}
            <Text style={styles.label}>Contraseña</Text>
            <View style={styles.inputContainer}>
              <MaterialIcons name="lock" size={20} color="#718096" style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="••••••••••••"
                placeholderTextColor="#A0AEC0"
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                editable={!loading}
              />
              <TouchableOpacity
                onPress={() => setShowPassword(!showPassword)}
                style={styles.eyeButton}
              >
                <MaterialIcons
                  name={showPassword ? 'visibility-off' : 'visibility'}
                  size={20}
                  color="#718096"
                />
              </TouchableOpacity>
            </View>

            {/* Submit Button */}
            <TouchableOpacity
              style={[styles.submitButton, loading && styles.submitButtonDisabled]}
              onPress={handleLogin}
              disabled={loading}
              activeOpacity={0.8}
            >
              {loading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <View style={styles.buttonInner}>
                  <Text style={styles.submitButtonText}>Entrar al Sistema</Text>
                  <MaterialIcons name="arrow-forward" size={20} color="#FFFFFF" />
                </View>
              )}
            </TouchableOpacity>

            {/* Server Config Toggle */}
            <TouchableOpacity
              style={styles.serverToggle}
              onPress={() => setShowServerConfig(!showServerConfig)}
              activeOpacity={0.7}
            >
              <MaterialIcons
                name="dns"
                size={16}
                color={isLocalActive ? '#D32F2F' : '#4A5568'}
              />
              <Text style={styles.serverToggleText}>
                Servidor: {currentServer.replace(/^https?:\/\//, '')}
              </Text>
              <MaterialIcons
                name={showServerConfig ? 'expand-less' : 'expand-more'}
                size={18}
                color="#718096"
              />
            </TouchableOpacity>

            {/* Panel de Configuración de Servidor */}
            {showServerConfig && (
              <View style={styles.serverConfigPanel}>
                <Text style={styles.serverConfigTitle}>Selecciona Servidor de Destino:</Text>

                {/* Preset 1: Docker Local LAN */}
                <TouchableOpacity
                  style={[
                    styles.presetBtn,
                    currentServer === DEFAULT_LOCAL_LAN_URL && styles.presetBtnActive,
                  ]}
                  onPress={() => handleApplyServer(DEFAULT_LOCAL_LAN_URL)}
                >
                  <MaterialIcons
                    name="wifi"
                    size={16}
                    color={currentServer === DEFAULT_LOCAL_LAN_URL ? '#D32F2F' : '#718096'}
                  />
                  <View style={styles.presetTextContainer}>
                    <Text style={styles.presetName}>Docker Local Wi-Fi (Esta PC)</Text>
                    <Text style={styles.presetUrl}>{DEFAULT_LOCAL_LAN_URL}</Text>
                  </View>
                  {currentServer === DEFAULT_LOCAL_LAN_URL && (
                    <MaterialIcons name="check-circle" size={16} color="#D32F2F" />
                  )}
                </TouchableOpacity>

                {/* Preset 2: Docker Local USB (localhost) */}
                <TouchableOpacity
                  style={[
                    styles.presetBtn,
                    currentServer === DEFAULT_LOCAL_USB_URL && styles.presetBtnActive,
                  ]}
                  onPress={() => handleApplyServer(DEFAULT_LOCAL_USB_URL)}
                >
                  <MaterialIcons
                    name="usb"
                    size={16}
                    color={currentServer === DEFAULT_LOCAL_USB_URL ? '#D32F2F' : '#718096'}
                  />
                  <View style={styles.presetTextContainer}>
                    <Text style={styles.presetName}>USB ADB Reverse (localhost:8002)</Text>
                    <Text style={styles.presetUrl}>{DEFAULT_LOCAL_USB_URL}</Text>
                  </View>
                  {currentServer === DEFAULT_LOCAL_USB_URL && (
                    <MaterialIcons name="check-circle" size={16} color="#D32F2F" />
                  )}
                </TouchableOpacity>

                {/* Preset 3: Producción */}
                <TouchableOpacity
                  style={[
                    styles.presetBtn,
                    currentServer === DEFAULT_PROD_URL && styles.presetBtnActive,
                  ]}
                  onPress={() => handleApplyServer(DEFAULT_PROD_URL)}
                >
                  <MaterialIcons
                    name="cloud"
                    size={16}
                    color={currentServer === DEFAULT_PROD_URL ? '#D32F2F' : '#718096'}
                  />
                  <View style={styles.presetTextContainer}>
                    <Text style={styles.presetName}>Nube Producción (gruporysa.com)</Text>
                    <Text style={styles.presetUrl}>{DEFAULT_PROD_URL}</Text>
                  </View>
                  {currentServer === DEFAULT_PROD_URL && (
                    <MaterialIcons name="check-circle" size={16} color="#D32F2F" />
                  )}
                </TouchableOpacity>

                {/* Servidor Personalizado */}
                <Text style={styles.customLabel}>O ingresa IP / URL manual:</Text>
                <View style={styles.customInputRow}>
                  <TextInput
                    style={styles.customInput}
                    value={customServer}
                    onChangeText={setCustomServer}
                    placeholder="http://192.168.X.X:8002/api"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <TouchableOpacity
                    style={styles.saveBtn}
                    onPress={() => handleApplyServer(customServer)}
                  >
                    <Text style={styles.saveBtnText}>Usar</Text>
                  </TouchableOpacity>
                </View>

                {/* Boton Probar Conexion */}
                <TouchableOpacity
                  style={[styles.testBtn, testingConnection && styles.testBtnDisabled]}
                  onPress={() => handleTestConnection()}
                  disabled={testingConnection}
                >
                  {testingConnection ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <>
                      <MaterialIcons name="network-check" size={16} color="#FFFFFF" />
                      <Text style={styles.testBtnText}>Probar Conexión Ahora</Text>
                    </>
                  )}
                </TouchableOpacity>

                {testResult && (
                  <View
                    style={[
                      styles.testResultBox,
                      testResult.ok ? styles.testResultBoxOk : styles.testResultBoxFail,
                    ]}
                  >
                    <MaterialIcons
                      name={testResult.ok ? 'check-circle' : 'cancel'}
                      size={16}
                      color={testResult.ok ? '#2E7D32' : '#C62828'}
                    />
                    <Text
                      style={[
                        styles.testResultText,
                        testResult.ok ? styles.testResultTextOk : styles.testResultTextFail,
                      ]}
                    >
                      {testResult.message}
                    </Text>
                  </View>
                )}
              </View>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#121820',
  },
  container: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 20,
    backgroundColor: '#121820',
  },
  header: {
    alignItems: 'center',
    marginBottom: 20,
  },
  logoImage: {
    width: 140,
    height: 95,
    marginBottom: 8,
  },
  brandTitle: {
    fontSize: 24,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 1.5,
  },
  brandSubtitle: {
    fontSize: 13,
    color: '#E2E8F0',
    marginTop: 4,
    fontWeight: '600',
  },
  brandVersion: {
    fontSize: 11,
    color: '#A0AEC0',
    marginTop: 2,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 22,
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#121820',
    marginBottom: 16,
    textAlign: 'center',
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFEBEE',
    padding: 10,
    borderRadius: 8,
    marginBottom: 14,
    borderLeftWidth: 4,
    borderLeftColor: '#D32F2F',
  },
  errorText: {
    color: '#C62828',
    fontSize: 12,
    marginLeft: 8,
    flex: 1,
    lineHeight: 16,
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    color: '#2D3748',
    marginBottom: 6,
    marginTop: 10,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 12,
    height: 46,
  },
  inputIcon: {
    marginRight: 8,
  },
  input: {
    flex: 1,
    fontSize: 14,
    color: '#1A202C',
  },
  eyeButton: {
    padding: 6,
  },
  submitButton: {
    backgroundColor: '#D32F2F',
    borderRadius: 10,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
    elevation: 3,
    shadowColor: '#D32F2F',
    shadowOpacity: 0.3,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  submitButtonDisabled: {
    backgroundColor: '#EF9A9A',
  },
  buttonInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  submitButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  serverToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 18,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: '#EDF2F7',
    gap: 6,
  },
  serverToggleText: {
    fontSize: 11,
    color: '#4A5568',
    fontWeight: '600',
    maxWidth: 220,
  },
  serverConfigPanel: {
    marginTop: 14,
    padding: 12,
    backgroundColor: '#F7FAFC',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  serverConfigTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#2D3748',
    marginBottom: 8,
  },
  presetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    padding: 8,
    borderRadius: 8,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 8,
  },
  presetBtnActive: {
    borderColor: '#D32F2F',
    backgroundColor: '#FFEBEE',
  },
  presetTextContainer: {
    flex: 1,
  },
  presetName: {
    fontSize: 12,
    fontWeight: '700',
    color: '#2D3748',
  },
  presetUrl: {
    fontSize: 10,
    color: '#718096',
  },
  customLabel: {
    fontSize: 11,
    color: '#718096',
    marginTop: 6,
    marginBottom: 4,
  },
  customInputRow: {
    flexDirection: 'row',
    gap: 6,
  },
  customInput: {
    flex: 1,
    height: 36,
    borderWidth: 1,
    borderColor: '#CBD5E0',
    borderRadius: 6,
    paddingHorizontal: 8,
    fontSize: 12,
    backgroundColor: '#FFFFFF',
  },
  saveBtn: {
    backgroundColor: '#D32F2F',
    paddingHorizontal: 14,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  saveBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 12,
  },
  testBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1E293B',
    paddingVertical: 8,
    borderRadius: 6,
    marginTop: 10,
    gap: 6,
  },
  testBtnDisabled: {
    backgroundColor: '#64748B',
  },
  testBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  testResultBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    borderRadius: 6,
    marginTop: 8,
    gap: 6,
  },
  testResultBoxOk: {
    backgroundColor: '#E8F5E9',
  },
  testResultBoxFail: {
    backgroundColor: '#FFEBEE',
  },
  testResultText: {
    fontSize: 11,
    fontWeight: '600',
    flex: 1,
  },
  testResultTextOk: {
    color: '#2E7D32',
  },
  testResultTextFail: {
    color: '#C62828',
  },
});
