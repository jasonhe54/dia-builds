#!/usr/bin/env python3

import sys
import json
import xml.etree.ElementTree as ET

def parse_cleaned_feed(xml_file):
    """
    Parses a "cleaned" Sparkle XML feed and prints a JSON array of items.
    
    This parser assumes the feed has been pre-processed to remove the
    invalid root-level 'xmlns' attributes.
    """
    
    # This is the namespace URI used by the <version> and <shortVersionString>
    # tags, and also for the 'sparkle:' attributes.
    SPARKLE_NS_URI = 'http://www.andymatuschak.org/xml-namespaces/sparkle'
    
    # We must register it with a prefix to find attributes like 'sparkle:deltaFrom'
    ET.register_namespace('sparkle', SPARKLE_NS_URI)

    # These are the keys we will use to find namespaced elements/attributes
    SPARKLE_VERSION_TAG = f'{{{SPARKLE_NS_URI}}}version'
    SPARKLE_SHORT_VER_TAG = f'{{{SPARKLE_NS_URI}}}shortVersionString'
    SPARKLE_DELTA_ATTR = f'{{{SPARKLE_NS_URI}}}deltaFrom'

    try:
        tree = ET.parse(xml_file)
        root = tree.getroot()
        
        items = []
        
        # Find all <item> tags. Since we cleaned the file, these are in
        # no namespace and can be found directly.
        for item in root.findall('.//item'):
            
            # These tags define their own default namespace, so we
            # must use the full {uri}name syntax to find them.
            version_elem = item.find(SPARKLE_VERSION_TAG)
            version = version_elem.text if version_elem is not None else ''

            short_version_elem = item.find(SPARKLE_SHORT_VER_TAG)
            short_version = short_version_elem.text if short_version_elem is not None else ''

            # 'description' is in no namespace
            desc_elem = item.find('description')
            description = desc_elem.text if desc_elem is not None else ''

            # Find the main enclosure. This is the 'enclosure' tag
            # that does NOT have a 'sparkle:deltaFrom' attribute.
            zip_url = ''
            for enclosure in item.findall('enclosure'):
                if SPARKLE_DELTA_ATTR not in enclosure.attrib:
                    # This is not a delta. Get its 'url' attribute.
                    zip_url = enclosure.attrib.get('url', '')
                    break  # Found the main download

            if version and short_version and zip_url:
                items.append({
                    'build_num': version.strip(),
                    'short_version_str': short_version.strip(),
                    'description': description.strip(),
                    'zip_url': zip_url
                })

        # Print the final list as a compact JSON string to stdout
        print(json.dumps(items, separators=(',', ':')))

    except ET.ParseError as e:
        print(f"Error: Failed to parse the cleaned XML: {e}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"An unexpected error occurred: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python parse_feed.py <path_to_feed.xml>", file=sys.stderr)
        sys.exit(1)
    
    parse_cleaned_feed(sys.argv[1])