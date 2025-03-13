import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Dimensions, Alert, TextInput, Modal, TouchableOpacity, ImageBackground, PanResponder, Platform, BackHandler } from 'react-native';
import { Polyline, Line, Text as SvgText } from 'react-native-svg';
import * as RNFS from 'react-native-fs';
import ViewShot from 'react-native-view-shot';
import Svg from 'react-native-svg';
import { GestureResponderEvent, PanResponderGestureState } from 'react-native';
import { accelerometer } from 'react-native-sensors';
import { PermissionsAndroid } from 'react-native';

const { width, height } = Dimensions.get('window');

// Printer page size: 8.5 x 11 inches at 300 DPI
const PRINTER_WIDTH_PX = 2550; // 8.5 inches * 300 DPI
const PRINTER_HEIGHT_PX = 3300; // 11 inches * 300 DPI

const App: React.FC = () => {
  const [mapping, setMapping] = useState<boolean>(false);
  const [path, setPath] = useState<{ x: number; y: number }[]>([]);
  const [position, setPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 }); // Start at origin (0, 0)
  const [windows, setWindows] = useState<{ x: number; y: number; number: number }[]>([]);
  const [doors, setDoors] = useState<{ x: number; y: number; number: number }[]>([]);
  const [slidingGlassDoors, setSlidingGlassDoors] = useState<{ x: number; y: number; number: number }[]>([]);
  const [rooms, setRooms] = useState<{ x: number; y: number; name: string; isDragging: boolean }[]>([]);
  const [labeling, setLabeling] = useState<boolean>(false);
  const [selectedRoom, setSelectedRoom] = useState<{ x: number; y: number; name: string; index: number } | null>(null);
  const [roomName, setRoomName] = useState<string>('');
  const [roomModalVisible, setRoomModalVisible] = useState<boolean>(false);
  const [exportConfirmVisible, setExportConfirmVisible] = useState<boolean>(false);
  const [customerName, setCustomerName] = useState<string>('');
  const [customerAddress, setCustomerAddress] = useState<string>('');
  const [mapOffset, setMapOffset] = useState({ x: 0, y: 0 });
  const [mapScale, setMapScale] = useState(1);
  const [lastPinchDistance, setLastPinchDistance] = useState<number | null>(null);
  const viewShotRef = useRef<ViewShot | null>(null);
  const accelSubscription = useRef<any>(null);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: (evt: GestureResponderEvent, gestureState: PanResponderGestureState) => {
        const shouldRespond = labeling && gestureState.numberActiveTouches === 1;
        if (shouldRespond) {
          console.log('PanResponder tap detected at:', evt.nativeEvent.locationX, evt.nativeEvent.locationY);
        }
        return shouldRespond;
      },
      onPanResponderGrant: (evt: GestureResponderEvent, gestureState: PanResponderGestureState) => {
        if (labeling) {
          const { locationX, locationY } = evt.nativeEvent;
          const scaledX = (locationX - mapOffset.x) / mapScale;
          const scaledY = (locationY - mapOffset.y) / mapScale;
          const index = rooms.findIndex((room) => {
            const dx = scaledX - room.x;
            const dy = scaledY - room.y;
            return dx * dx + dy * dy < 400 / (mapScale * mapScale);
          });
          if (index !== -1) {
            setSelectedRoom({ ...rooms[index], index });
            setRooms((prev) =>
              prev.map((room, i) => (i === index ? { ...room, isDragging: true } : room))
            );
          } else {
            startLabelingRoom(scaledX, scaledY);
          }
          if (gestureState.numberActiveTouches === 2) {
            const dx = gestureState.dx;
            const dy = gestureState.dy;
            setLastPinchDistance(Math.sqrt(dx * dx + dy * dy));
          }
        }
      },
      onPanResponderMove: (_: any, gestureState: PanResponderGestureState) => {
        if (labeling) {
          if (selectedRoom) {
            setRooms((prev) =>
              prev.map((room, i) =>
                i === selectedRoom.index
                  ? { ...room, x: room.x + gestureState.dx / mapScale, y: room.y + gestureState.dy / mapScale, isDragging: true }
                  : room
              )
            );
          } else if (gestureState.numberActiveTouches === 2 && lastPinchDistance) {
            const currentDistance = Math.sqrt(gestureState.dx * gestureState.dx + gestureState.dy * gestureState.dy);
            const scaleChange = currentDistance / lastPinchDistance;
            const newScale = Math.max(0.5, Math.min(3, mapScale * scaleChange));
            setMapScale(newScale);
            setLastPinchDistance(currentDistance);
          } else if (gestureState.numberActiveTouches === 1) {
            setMapOffset({
              x: mapOffset.x + gestureState.dx,
              y: mapOffset.y + gestureState.dy,
            });
          }
        }
      },
      onPanResponderRelease: () => {
        if (labeling && selectedRoom) {
          setRooms((prev) =>
            prev.map((room, i) => (i === selectedRoom.index ? { ...room, isDragging: false } : room))
          );
          setSelectedRoom(null);
        }
        setLastPinchDistance(null);
      },
    })
  ).current;

  const handleMapPress = (event: any) => {
    if (labeling) {
      const { locationX, locationY } = event.nativeEvent;
      const scaledX = (locationX - mapOffset.x) / mapScale;
      const scaledY = (locationY - mapOffset.y) / mapScale;
      const index = rooms.findIndex((room) => {
        const dx = scaledX - room.x;
        const dy = scaledY - room.y;
        return dx * dx + dy * dy < 400 / (mapScale * mapScale);
      });
      if (index !== -1) {
        setSelectedRoom({ ...rooms[index], index });
        setRooms((prev) =>
          prev.map((room, i) => (i === index ? { ...room, isDragging: true } : room))
        );
      } else {
        startLabelingRoom(scaledX, scaledY);
      }
    }
  };

  const requestPermissions = async () => {
    if (Platform.OS === 'android') {
      try {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION,
          {
            title: 'Motion Sensor Permission',
            message: 'This app needs access to motion sensors to map your movement.',
            buttonNeutral: 'Ask Me Later',
            buttonNegative: 'Cancel',
            buttonPositive: 'OK',
          }
        );
        if (granted === PermissionsAndroid.RESULTS.GRANTED) {
          console.log('Motion sensor permission granted on Android');
        } else {
          Alert.alert('Permission Denied', 'Motion sensor access is required for mapping.');
        }
      } catch (err) {
        console.warn('Permission request error:', err);
      }
    } else if (Platform.OS === 'ios') {
      console.log('iOS motion sensor permission requested via Info.plist');
    }
  };

  useEffect(() => {
    requestPermissions();

    if (mapping && !accelSubscription.current) {
      accelSubscription.current = accelerometer.subscribe(({ x, y, z }) => {
        // Adjust position based on accelerometer tilt (x for horizontal, y for vertical movement)
        const sensitivity = 5; // Adjust for smoother movement
        const newX = position.x + (x * sensitivity);
        const newY = position.y - (y * sensitivity); // Invert y for intuitive upward movement
        const maxX = PRINTER_WIDTH_PX / 300; // Max X in inches (converted to pixels later)
        const maxY = PRINTER_HEIGHT_PX / 300; // Max Y in inches
        const minX = 0;
        const minY = 0;

        const clampedX = Math.max(minX, Math.min(newX, maxX));
        const clampedY = Math.max(minY, Math.min(newY, maxY));

        setPosition({ x: clampedX, y: clampedY });
        setPath((prev) => [...prev, { x: clampedX, y: clampedY }]);
        console.log('Accelerometer: x=', x.toFixed(2), 'y=', y.toFixed(2), 'z=', z.toFixed(2), 'Position:', { x: clampedX.toFixed(2), y: clampedY.toFixed(2) });
      });
    } else if (!mapping && accelSubscription.current) {
      accelSubscription.current.unsubscribe();
      accelSubscription.current = null;
    }

    return () => {
      if (accelSubscription.current) {
        accelSubscription.current.unsubscribe();
      }
    };
  }, [mapping, position]);

  const startMapping = () => {
    if (!customerName.trim() || !customerAddress.trim()) {
      Alert.alert('Error', 'Please enter customer name and address');
      return;
    }
    setMapping(true);
    setPath([{ x: 0, y: 0 }]); // Start at origin
    setPosition({ x: 0, y: 0 });
    setWindows([]);
    setDoors([]);
    setSlidingGlassDoors([]);
    setRooms([]);
    setMapOffset({ x: 0, y: 0 });
    setMapScale(1);
    setLastPinchDistance(null);
    console.log('Started mapping with accelerometer');
  };

  const stopMapping = () => {
    if (accelSubscription.current) {
      accelSubscription.current.unsubscribe();
      accelSubscription.current = null;
    }
    setMapping(false);
    setLabeling(true);
    console.log('Stopped mapping, entering labeling mode');
  };

  const addWindow = () => {
    setWindows((prev) => [...prev, { x: position.x, y: position.y, number: prev.length + 1 }]);
    console.log('Added a window at:', position);
  };

  const addDoor = () => {
    setDoors((prev) => [...prev, { x: position.x, y: position.y, number: prev.length + 1 }]);
    console.log('Added a door at:', position);
  };

  const addSlidingGlassDoor = () => {
    setSlidingGlassDoors((prev) => [...prev, { x: position.x, y: position.y, number: prev.length + 1 }]);
    console.log('Added a sliding glass door at:', position);
  };

  const startLabelingRoom = (x: number, y: number) => {
    setSelectedRoom({ x, y, name: '', index: rooms.length });
    setRoomModalVisible(true);
  };

  const saveRoomLabel = () => {
    if (selectedRoom && roomName.trim() !== '') {
      setRooms((prev) => [...prev, { ...selectedRoom, name: roomName, isDragging: false }]);
      console.log('Added room label:', roomName, 'at:', selectedRoom);
    }
    setRoomName('');
    setRoomModalVisible(false);
    setSelectedRoom(null);
  };

  const exportMap = async () => {
    setLabeling(false);
    setExportConfirmVisible(true);
    if (!viewShotRef.current) {
      console.error('ViewShot ref is null');
      Alert.alert('Error', 'Failed to initialize map capture');
      return;
    }

    try {
      console.log('Starting export process...');
      const uri = await viewShotRef.current.capture();
      console.log('Capture successful, URI:', uri);

      const baseFileName = `${customerName}_${customerAddress}`.trim().replace(/\s+/g, '_').toLowerCase();
      const tempFilePath = `${RNFS.CachesDirectoryPath}/${baseFileName}.png`;
      await RNFS.moveFile(uri, tempFilePath);
      console.log('Moved to temp file:', tempFilePath);

      const galleryFolderPath = Platform.OS === 'ios'
        ? `${RNFS.DocumentDirectoryPath}/WindowWise`
        : `${RNFS.ExternalStorageDirectoryPath}/Pictures/WindowWise`;
      await RNFS.mkdir(galleryFolderPath);
      console.log('Created gallery folder:', galleryFolderPath);

      const galleryFilePath = `${galleryFolderPath}/${baseFileName}.png`;
      const getUniqueFilePath = async (path: string, suffix = 0): Promise<string> => {
        const newPath = suffix === 0 ? path : `${path.slice(0, -4)}_${suffix}.png`;
        const exists = await RNFS.exists(newPath);
        if (!exists) return newPath;
        return getUniqueFilePath(path, suffix + 1);
      };

      const uniqueFilePath = await getUniqueFilePath(galleryFilePath);
      console.log('Unique file path:', uniqueFilePath);

      await RNFS.copyFile(tempFilePath, uniqueFilePath);
      console.log('Copied to gallery:', uniqueFilePath);
      Alert.alert('Success', `Map saved to ${Platform.OS === 'ios' ? 'Documents' : 'Photo Gallery'} in WindowWise folder as ${baseFileName}.png`);

      await RNFS.unlink(tempFilePath);
      console.log('Temp file cleaned up');
    } catch (error: any) {
      console.error('Export error:', error);
      Alert.alert('Error', 'Failed to export map: ' + error.message);
    }
  };

  const closeApp = () => {
    if (Platform.OS === 'android') {
      BackHandler.exitApp();
    } else {
      resetToWelcome();
      Alert.alert('Note', 'On iOS, the app cannot be closed programmatically. Returning to welcome screen.');
    }
    setExportConfirmVisible(false);
  };

  const resetToWelcome = () => {
    setExportConfirmVisible(false);
    setCustomerName('');
    setCustomerAddress('');
    setMapping(false);
    setLabeling(false);
    setPath([]);
    setWindows([]);
    setDoors([]);
    setSlidingGlassDoors([]);
    setRooms([]);
    setMapOffset({ x: 0, y: 0 });
    setMapScale(1);
    setLastPinchDistance(null);
    if (accelSubscription.current) {
      accelSubscription.current.unsubscribe();
      accelSubscription.current = null;
    }
  };

  return (
    <View style={styles.container}>
      <Modal
        animationType="slide"
        transparent={true}
        visible={roomModalVisible}
        onRequestClose={() => setRoomModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitle}>Label Room</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter room name"
              placeholderTextColor="#888"
              value={roomName}
              onChangeText={setRoomName}
              autoFocus
            />
            <View style={styles.modalButtonContainer}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton]}
                onPress={() => setRoomModalVisible(false)}
              >
                <Text style={styles.modalButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.saveButton]}
                onPress={saveRoomLabel}
              >
                <Text style={styles.modalButtonText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="slide"
        transparent={true}
        visible={exportConfirmVisible}
        onRequestClose={() => setExportConfirmVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitle}>Thank You!</Text>
            <Text style={styles.modalMessage}>Thank you for using WindowWise!</Text>
            <View style={styles.modalButtonContainer}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton]}
                onPress={resetToWelcome}
              >
                <Text style={styles.modalButtonText}>New Map</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.saveButton]}
                onPress={closeApp}
              >
                <Text style={styles.modalButtonText}>Close App</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Text style={styles.title}>WindowWise</Text>
      {!mapping && !labeling && (
        <ImageBackground
          source={require('./assets/background.jpg')}
          style={styles.fullBackground}
          imageStyle={styles.fullBackgroundImage}
        >
          <View style={styles.inputContainer}>
            <Text style={styles.welcomeMessage}>Welcome to WindowWise! Enter customer details to map windows and doors.</Text>
            <TextInput
              style={styles.input}
              placeholder="Customer's Name"
              placeholderTextColor="#888"
              value={customerName}
              onChangeText={setCustomerName}
            />
            <TextInput
              style={styles.input}
              placeholder="Customer's Address"
              placeholderTextColor="#888"
              value={customerAddress}
              onChangeText={setCustomerAddress}
              multiline
            />
            <TouchableOpacity
              style={[
                styles.button,
                (customerName.trim() && customerAddress.trim()) ? styles.buttonEnabled : styles.buttonDisabled,
              ]}
              onPress={startMapping}
              disabled={!customerName.trim() || !customerAddress.trim()}
            >
              <Text style={styles.buttonText}>Start Mapping</Text>
            </TouchableOpacity>
          </View>
        </ImageBackground>
      )}
      {mapping && (
        <View>
          <ImageBackground
            source={require('./assets/background.jpg')}
            style={styles.background}
            imageStyle={styles.backgroundImage}
          >
            <View style={styles.mapArea}>
              <Text style={styles.customerName}>{customerName || 'Unnamed Customer'}</Text>
              <Text style={styles.customerAddress}>{customerAddress || 'No Address Provided'}</Text>
              <Svg height={height * 0.35} width={width * 0.9}>
                {path.length > 1 && (
                  <Polyline
                    points={path.map((p) => `${p.x},${p.y}`).join(' ')}
                    fill="none"
                    stroke="#4a90e2"
                    strokeWidth={2}
                  />
                )}
                {windows.map((win, index) => {
                  const angle = calculatePerpendicularAngle(path, index);
                  return (
                    <React.Fragment key={`window-${index}`}>
                      <Line
                        x1={win.x - 10 * Math.cos(angle)}
                        y1={win.y - 10 * Math.sin(angle)}
                        x2={win.x + 10 * Math.cos(angle)}
                        y2={win.y + 10 * Math.sin(angle)}
                        stroke="#ff4d4d"
                        strokeWidth={2}
                      />
                      <SvgText
                        x={win.x + 20}
                        y={win.y}
                        fontSize={12}
                        fill="#ff4d4d"
                        textAnchor="start"
                      >
                        W{win.number}
                      </SvgText>
                    </React.Fragment>
                  );
                })}
                {doors.map((door, index) => {
                  const angle = calculatePerpendicularAngle(path, index);
                  return (
                    <React.Fragment key={`door-${index}`}>
                      <Line
                        x1={door.x - 10 * Math.cos(angle)}
                        y1={door.y - 10 * Math.sin(angle)}
                        x2={door.x + 10 * Math.cos(angle)}
                        y2={door.y + 10 * Math.sin(angle)}
                        stroke="#4caf50"
                        strokeWidth={2}
                      />
                      <SvgText
                        x={door.x + 20}
                        y={door.y}
                        fontSize={12}
                        fill="#4caf50"
                        textAnchor="start"
                      >
                        D{door.number}
                      </SvgText>
                    </React.Fragment>
                  );
                })}
                {slidingGlassDoors.map((sgd, index) => {
                  const angle = calculatePerpendicularAngle(path, index);
                  return (
                    <React.Fragment key={`sgd-${index}`}>
                      <Line
                        x1={sgd.x - 10 * Math.cos(angle)}
                        y1={sgd.y - 10 * Math.sin(angle)}
                        x2={sgd.x + 10 * Math.cos(angle)}
                        y2={sgd.y + 10 * Math.sin(angle)}
                        stroke="#ffeb3b"
                        strokeWidth={2}
                      />
                      <SvgText
                        x={sgd.x + 20}
                        y={sgd.y}
                        fontSize={12}
                        fill="#ffeb3b"
                        textAnchor="start"
                      >
                        S{sgd.number}
                      </SvgText>
                    </React.Fragment>
                  );
                })}
                {rooms.map((room) => (
                  <SvgText
                    key={`${room.x},${room.y}`}
                    x={room.x}
                    y={room.y}
                    fontSize={14}
                    fill="#333"
                    textAnchor="middle"
                  >
                    {room.name}
                  </SvgText>
                ))}
              </Svg>
            </View>
          </ImageBackground>
          <View style={styles.buttonContainer}>
            <TouchableOpacity style={[styles.button, styles.buttonEnabled]} onPress={addWindow}>
              <Text style={styles.buttonText}>+Window</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.button, styles.buttonEnabled]} onPress={addDoor}>
              <Text style={styles.buttonText}>+Door</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.button, styles.buttonEnabled]} onPress={addSlidingGlassDoor}>
              <Text style={styles.buttonText}>+Sliding Door</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.button, styles.buttonEnabled]} onPress={stopMapping}>
              <Text style={styles.buttonText}>Finish Mapping</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
      {labeling && (
        <View style={styles.labelingContainer}>
          <ImageBackground
            source={require('./assets/background.jpg')}
            style={styles.labelingBackground}
            imageStyle={styles.backgroundImage}
          >
            <ViewShot
              ref={viewShotRef}
              options={{
                format: 'png',
                quality: 1.0,
                width: PRINTER_WIDTH_PX,
                height: PRINTER_HEIGHT_PX,
              }}
            >
              <View
                {...panResponder.panHandlers}
                onTouchStart={handleMapPress}
                style={styles.labelingMapArea}
              >
                <Svg
                  height={height * 0.6}
                  width={width * 0.9}
                  viewBox={`-${mapOffset.x / mapScale} -${mapOffset.y / mapScale} ${width * 0.9 / mapScale} ${height * 0.6 / mapScale}`}
                >
                  {path.length > 1 && (
                    <Polyline
                      points={path.map((p) => `${p.x},${p.y}`).join(' ')}
                      fill="none"
                      stroke="#4a90e2"
                      strokeWidth={2 / mapScale}
                    />
                  )}
                  {windows.map((win, index) => {
                    const angle = calculatePerpendicularAngle(path, index);
                    return (
                      <React.Fragment key={`window-${index}`}>
                        <Line
                          x1={win.x - 10 * Math.cos(angle)}
                          y1={win.y - 10 * Math.sin(angle)}
                          x2={win.x + 10 * Math.cos(angle)}
                          y2={win.y + 10 * Math.sin(angle)}
                          stroke="#ff4d4d"
                          strokeWidth={2 / mapScale}
                        />
                        <SvgText
                          x={win.x + 20 / mapScale}
                          y={win.y}
                          fontSize={12 / mapScale}
                          fill="#ff4d4d"
                          textAnchor="start"
                        >
                          W{win.number}
                        </SvgText>
                      </React.Fragment>
                    );
                  })}
                  {doors.map((door, index) => {
                    const angle = calculatePerpendicularAngle(path, index);
                    return (
                      <React.Fragment key={`door-${index}`}>
                        <Line
                          x1={door.x - 10 * Math.cos(angle)}
                          y1={door.y - 10 * Math.sin(angle)}
                          x2={door.x + 10 * Math.cos(angle)}
                          y2={door.y + 10 * Math.sin(angle)}
                          stroke="#4caf50"
                          strokeWidth={2 / mapScale}
                        />
                        <SvgText
                          x={door.x + 20 / mapScale}
                          y={door.y}
                          fontSize={12 / mapScale}
                          fill="#4caf50"
                          textAnchor="start"
                        >
                          D{door.number}
                        </SvgText>
                      </React.Fragment>
                    );
                  })}
                  {slidingGlassDoors.map((sgd, index) => {
                    const angle = calculatePerpendicularAngle(path, index);
                    return (
                      <React.Fragment key={`sgd-${index}`}>
                        <Line
                          x1={sgd.x - 10 * Math.cos(angle)}
                          y1={sgd.y - 10 * Math.sin(angle)}
                          x2={sgd.x + 10 * Math.cos(angle)}
                          y2={sgd.y + 10 * Math.sin(angle)}
                          stroke="#ffeb3b"
                          strokeWidth={2 / mapScale}
                        />
                        <SvgText
                          x={sgd.x + 20 / mapScale}
                          y={sgd.y}
                          fontSize={12 / mapScale}
                          fill="#ffeb3b"
                          textAnchor="start"
                        >
                          S{sgd.number}
                        </SvgText>
                      </React.Fragment>
                    );
                  })}
                  {rooms.map((room) => (
                    <SvgText
                      key={`${room.x},${room.y}`}
                      x={room.x}
                      y={room.y}
                      fontSize={14 / mapScale}
                      fill="#333"
                      textAnchor="middle"
                    >
                      {room.name}
                    </SvgText>
                  ))}
                </Svg>
              </View>
            </ViewShot>
            <View style={styles.labelingButtonContainer}>
              <TouchableOpacity style={[styles.button, styles.buttonEnabled]} onPress={exportMap}>
                <Text style={styles.buttonText}>Export Map</Text>
              </TouchableOpacity>
            </View>
          </ImageBackground>
        </View>
      )}
    </View>
  );
};

const calculatePerpendicularAngle = (path: { x: number; y: number }[], index: number): number => {
  if (path.length < 2) return 0;
  const i = path.findIndex((p, idx) => idx > 0 && p.x === path[index].x && p.y === path[index].y);
  if (i <= 0) return 0;
  const dx = path[i].x - path[i - 1].x;
  const dy = path[i].y - path[i - 1].y;
  return Math.atan2(dy, dx) + Math.PI / 2;
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#e6f0fa',
    paddingTop: Platform.OS === 'android' ? 25 : 0,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#1a3c34',
    marginTop: 30,
    marginBottom: 10,
  },
  welcomeMessage: {
    fontSize: 18,
    color: '#1a3c34',
    textAlign: 'center',
    marginBottom: 20,
  },
  inputContainer: {
    width: width * 0.9,
    alignItems: 'center',
    marginVertical: 20,
    padding: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
  },
  mapArea: {
    width: width * 0.9,
    height: height * 0.35,
    borderWidth: 2,
    borderColor: '#1a3c34',
    borderRadius: 10,
    backgroundColor: '#ffffff',
    justifyContent: 'flex-start',
    alignItems: 'center',
    marginVertical: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 5,
    position: 'relative',
  },
  customerName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1a3c34',
    padding: 5,
    textAlign: 'center',
  },
  customerAddress: {
    fontSize: 16,
    color: '#1a3c34',
    padding: 5,
    textAlign: 'center',
    marginBottom: 10,
  },
  fullBackground: {
    flex: 1,
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullBackgroundImage: {
    opacity: 0.8,
  },
  background: {
    width: width * 0.9,
    height: height * 0.35,
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: 20,
  },
  labelingBackground: {
    width: width * 0.9,
    height: height * 0.7,
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: 10,
  },
  labelingMapArea: {
    width: width * 0.9,
    height: height * 0.6,
    borderWidth: 2,
    borderColor: '#1a3c34',
    borderRadius: 10,
    backgroundColor: '#ffffff',
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 5,
  },
  labelingButtonContainer: {
    width: width * 0.9,
    alignItems: 'center',
    marginVertical: 10,
    paddingBottom: Platform.OS === 'android' ? 20 : 40,
  },
  backgroundImage: {
    opacity: 0.8,
    borderRadius: 10,
  },
  buttonContainer: {
    width: width * 0.9,
    flexDirection: 'column',
    justifyContent: 'space-around',
    height: height * 0.4,
    padding: 10,
    marginTop: -20,
  },
  labelingContainer: {
    width: width * 0.9,
    flexDirection: 'column',
    justifyContent: 'space-around',
    height: height * 0.7,
    padding: 10,
  },
  labelingText: {
    fontSize: 16,
    color: '#1a3c34',
    textAlign: 'center',
    marginBottom: 10,
  },
  input: {
    width: '100%',
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 5,
    padding: 10,
    marginVertical: 10,
    fontSize: 16,
    color: '#333',
    backgroundColor: '#ffffff',
  },
  button: {
    backgroundColor: '#4a90e2',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 20,
    marginVertical: 5,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 5,
    borderWidth: 1,
    borderColor: '#ffffff',
  },
  buttonEnabled: {
    backgroundColor: '#4a90e2',
  },
  buttonDisabled: {
    backgroundColor: '#b0c4de',
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalContainer: {
    width: width * 0.8,
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 20,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1a3c34',
    marginBottom: 15,
  },
  modalMessage: {
    fontSize: 16,
    color: '#1a3c34',
    textAlign: 'center',
    marginBottom: 20,
  },
  modalButtonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
  },
  modalButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 5,
    alignItems: 'center',
    marginHorizontal: 5,
  },
  cancelButton: {
    backgroundColor: '#ff4d4d',
  },
  saveButton: {
    backgroundColor: '#4a90e2',
  },
  modalButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});

export default App;