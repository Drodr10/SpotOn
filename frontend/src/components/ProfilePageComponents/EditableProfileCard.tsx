import { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  Dimensions,
  TouchableOpacity,
  TextInput,
} from 'react-native';

import penIcon from '@/assets/images/penicon.png';
import starIcon from '@/assets/images/staricon.png';
import checkIcon from '@/assets/images/checkmarkicon.png'
import { withLightHaptic } from '@/src/utils/haptics';

const { width: screenWidth } = Dimensions.get('window');
const H_PAD          = screenWidth * 0.05;   
const SECTION_GAP    = screenWidth * 0.05;   
const LOGO_SIZE      = screenWidth * 0.12; 
const SECTION_LABEL  = screenWidth * 0.05;  

type CardProps = {
  name: string;
  setName: (text: string) => void;
  rating: number;
}

export default function EditableProfileCard({ name, setName, rating }: CardProps) {
  // Hooks must run before any early return: React matches them up by call
  // ORDER across renders, so a return that skips them makes one render call
  // three hooks and the next call none, which throws "rendered fewer hooks
  // than expected" and unmounts the card. Reachable today — `!rating` is true
  // for a rating of 0, i.e. every brand-new user, so the component bailed out
  // early and then crashed as soon as a real rating arrived.
  const inputArea = useRef<TextInput>(null);

  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (editing) {
      inputArea.current?.focus();
    }
  }, [editing]);

  // Same condition as before, just moved below the hooks so rendering is
  // unchanged. NOTE: `!rating` also hides the card for a legitimate 0 rating —
  // left as-is because whether a new user should see their own card is a
  // product call, not a lint fix.
  if (!setName || !rating) {
    return null;
  }

  const editUsername = () => {
    setEditing(!editing);
  }
  
  return(
      <View style={styles.container}>
        <View>
          <Image style={styles.profileImage}/>
        </View>

        <View >
          {editing ?
          <TextInput style={styles.editText} onChangeText={setName} value={name} placeholder={'Edit Username'} ref={inputArea}></TextInput>: 
          <Text style={styles.profileText}>{name}</Text> 
          }
          <View style={styles.ratingRow}>
            <Image style={styles.starImage} source={starIcon}/>
            <Text style={styles.profileText}>{rating}</Text>
          </View>
        </View>

        <View>
          <TouchableOpacity onPress={withLightHaptic(editUsername)}>
            <Image style={styles.editImage} source={editing ? checkIcon : penIcon}/>
          </TouchableOpacity>
          <Image />
        </View>

      </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'transparent',
    width: '100%',
    paddingLeft: H_PAD,
    paddingRight: H_PAD,
  },
  containerSection: {
    flex: 1,
    gap: 10,
  },
  profileImage: {
    backgroundColor: '#373736',
    height: 100,
    width: 100,
    borderRadius: 999,
  },
  profileText: {
    fontSize: SECTION_LABEL,
    fontFamily: 'Switzer',
    color: '#000000',
  },
  editText: {
    fontSize: SECTION_LABEL,
    fontFamily: 'Switzer',
    color: '#000000',
    backgroundColor: '#',
  },
  editImage: {
    height: SECTION_LABEL + 5,
    width: SECTION_LABEL + 5,
  },
  starImage: {
    height: SECTION_LABEL,
    width: SECTION_LABEL,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  }
});
